import { z } from 'zod';
import {
  addressIdSchema,
  changeSetIdSchema,
  deviceIdSchema,
  flowIdSchema,
  identityIdSchema,
  interfaceIdSchema,
  newId,
  operationIdSchema,
  projectIdSchema,
  roleAssignmentIdSchema,
  serviceIdSchema,
  type ProjectId,
} from '../ids.js';
import {
  addressSchema,
  deviceSchema,
  flowSchema,
  identitySchema,
  interfaceSchema,
  roleAssignmentSchema,
  serviceSchema,
  type Device,
  type Flow,
  type Identity,
} from '../entities.js';
import {
  operationSchema,
  fieldValueSchema,
  type FieldValue,
  type Operation,
} from '../operations.js';
import type { FlowEndpoint } from '../endpoints.js';
import type { ProjectState } from '../state.js';
import {
  fieldProvenanceIdSchema,
  importJobIdSchema,
  type FieldProvenance,
  type ImportJob,
  type Observation,
  type ObservationId,
} from '../imports.js';
import { normalizeHostname, normalizeIp, normalizeMac } from './normalize.js';
import type {
  CandidateSet,
  DeviceCandidate,
  FieldValueCandidate,
  FlowCandidate,
} from './candidates.js';

/**
 * Reconciliation as ChangeSet editing (ADR-0021): scored candidates become a
 * proposed — not yet applied — ChangeSet of Create/SetField Operations.
 * Candidates that look like an existing committed object become conflicts the
 * operator resolves; each resolution rewrites the pending ChangeSet. The
 * system never silently merges across imports.
 */

export const importResolutionActionSchema = z.enum(['merge', 'keepSeparate', 'replace', 'ignore']);
export type ImportResolutionAction = z.infer<typeof importResolutionActionSchema>;

export const importConflictSchema = z.object({
  id: z.uuidv7(),
  candidateKey: z.string(),
  entityType: z.enum(['device', 'identity', 'flow']),
  existingEntityId: z.uuidv7(),
  /** Human-readable label of the imported candidate, for the review UI. */
  summary: z.string(),
  fieldDiffs: z.array(
    z.object({
      field: z.string(),
      existingValue: fieldValueSchema,
      proposedValue: fieldValueSchema,
    }),
  ),
  resolution: z.union([z.literal('pending'), importResolutionActionSchema]),
});
export type ImportConflict = z.infer<typeof importConflictSchema>;

export const importProposalSchema = z.object({
  importJobId: importJobIdSchema,
  projectId: projectIdSchema,
  /** Minted at build time; becomes the applied ChangeSet — the rollback boundary. */
  changeSetId: changeSetIdSchema,
  label: z.string().min(1),
  operations: z.array(operationSchema),
  /** candidateKey → target entity id (minted for creates, existing after a merge). */
  entityIds: z.record(z.string(), z.uuidv7()),
  conflicts: z.array(importConflictSchema),
  updatedAt: z.iso.datetime(),
});
export type ImportProposal = z.infer<typeof importProposalSchema>;

/** Read an entity's fields generically, without a type assertion. */
function recordOf(entity: unknown): Record<string, FieldValue> {
  return z.record(z.string(), fieldValueSchema).parse(JSON.parse(JSON.stringify(entity)));
}

// ---------------------------------------------------------------------------
// matching against the committed graph
// ---------------------------------------------------------------------------

interface ExistingIndex {
  deviceByMac: Map<string, Device>;
  deviceByHostname: Map<string, Device>;
  deviceByIp: Map<string, Device>;
  identityByKey: Map<string, Identity>;
  flowByKey: Map<string, Flow>;
}

function indexExisting(state: ProjectState): ExistingIndex {
  const deviceById = new Map(state.devices.map((d) => [d.id, d]));
  const deviceByInterface = new Map(
    state.interfaces.map((i) => [i.id, deviceById.get(i.deviceId)]),
  );
  const index: ExistingIndex = {
    deviceByMac: new Map(),
    deviceByHostname: new Map(),
    deviceByIp: new Map(),
    identityByKey: new Map(),
    flowByKey: new Map(),
  };
  for (const device of state.devices) {
    index.deviceByHostname.set(normalizeHostname(device.name), device);
  }
  for (const address of state.addresses) {
    const device = deviceByInterface.get(address.interfaceId);
    if (!device) continue;
    if (address.kind === 'mac') index.deviceByMac.set(normalizeMac(address.value), device);
    if (address.kind === 'ipv4' || address.kind === 'ipv6') {
      index.deviceByIp.set(normalizeIp(address.value), device);
    }
    if (address.kind === 'hostname') {
      index.deviceByHostname.set(normalizeHostname(address.value), device);
    }
  }
  for (const identity of state.identities) {
    index.identityByKey.set(existingIdentityKey(identity, deviceById), identity);
  }
  for (const flow of state.flows) {
    index.flowByKey.set(existingFlowKey(flow), flow);
  }
  return index;
}

function existingIdentityKey(identity: Identity, deviceById: Map<string, Device>): string {
  if (identity.scope === 'domain') {
    return `domain:${identity.domain.toUpperCase()}\\${identity.name.toLowerCase()}`;
  }
  const host = identity.deviceId ? (deviceById.get(identity.deviceId)?.id ?? '') : '';
  return `local:${host}:${identity.name.toLowerCase()}`;
}

function flowEndpointLabel(endpoint: FlowEndpoint): string {
  return endpoint.kind === 'external'
    ? `external:${endpoint.value}`
    : `${endpoint.kind}:${endpoint.id}`;
}

function existingFlowKey(flow: Flow): string {
  return `${flowEndpointLabel(flow.source)}->${flowEndpointLabel(flow.destination)}:${flow.protocol}/${flow.port ?? 'any'}`;
}

function matchDevice(index: ExistingIndex, candidate: DeviceCandidate): Device | undefined {
  for (const mac of candidate.hints.macs) {
    const hit = index.deviceByMac.get(mac);
    if (hit) return hit;
  }
  for (const hostname of candidate.hints.hostnames) {
    const hit = index.deviceByHostname.get(hostname);
    if (hit) return hit;
  }
  for (const ip of candidate.hints.ips) {
    const hit = index.deviceByIp.get(ip);
    if (hit) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// building the proposal
// ---------------------------------------------------------------------------

function winning(
  fields: Record<string, FieldValueCandidate[]>,
  field: string,
): FieldValue | undefined {
  return fields[field]?.[0]?.value;
}

function winningString(
  fields: Record<string, FieldValueCandidate[]>,
  field: string,
): string | undefined {
  const value = winning(fields, field);
  return typeof value === 'string' ? value : undefined;
}

/** The auto-created holder for addresses observed without an interface name. */
const IMPLIED_INTERFACE_NAME = 'imported0';

export function buildProposal(
  state: ProjectState,
  job: ImportJob,
  candidates: CandidateSet,
  now: string,
): ImportProposal {
  const projectId = projectIdSchema.parse(state.project.id);
  const index = indexExisting(state);
  const operations: Operation[] = [];
  const entityIds: Record<string, string> = {};
  const conflicts: ImportConflict[] = [];

  const op = (operation: Operation) => operations.push(operationSchema.parse(operation));
  const opBase = () => ({ id: newId(operationIdSchema), projectId });

  // --- devices ---
  let deviceIndex = 0;
  for (const candidate of candidates.devices) {
    const deviceId = newId(deviceIdSchema);
    entityIds[candidate.key] = deviceId;
    // grid-stagger so a multi-host import doesn't stack nodes on the canvas
    const position = {
      x: 80 + (deviceIndex % 6) * 190,
      y: 140 + Math.floor(deviceIndex / 6) * 130,
    };
    deviceIndex += 1;
    const name =
      winningString(candidate.fields, 'name') ??
      candidate.hints.hostnames[0] ??
      candidate.hints.ips[0] ??
      candidate.hints.macs[0] ??
      candidate.key;
    const entity = deviceSchema.parse({
      id: deviceId,
      projectId,
      name,
      deviceType: winningString(candidate.fields, 'deviceType') ?? 'custom',
      vendor: winningString(candidate.fields, 'vendor') ?? '',
      model: winningString(candidate.fields, 'model') ?? '',
      os: winningString(candidate.fields, 'os') ?? '',
      location: winningString(candidate.fields, 'location') ?? '',
      lifecycleState: candidate.impliedOnly ? 'inferred' : 'observed',
      position,
    });
    op({ ...opBase(), kind: 'CreateEntity', payload: { entityType: 'device', entity } });

    const existing = matchDevice(index, candidate);
    if (existing) {
      const fieldDiffs = Object.entries(candidate.fields)
        .map(([field, values]) => {
          const proposedValue = values[0]?.value ?? null;
          const existingValue = recordOf(existing)[field] ?? null;
          return { field, existingValue, proposedValue };
        })
        .filter(
          (diff) =>
            JSON.stringify(diff.existingValue) !== JSON.stringify(diff.proposedValue) &&
            diff.existingValue !== '' &&
            diff.existingValue !== null,
        );
      conflicts.push(
        importConflictSchema.parse({
          id: newId(z.uuidv7()),
          candidateKey: candidate.key,
          entityType: 'device',
          existingEntityId: existing.id,
          summary: `Imported device "${name}" matches existing "${existing.name}"`,
          fieldDiffs,
          resolution: 'pending',
        }),
      );
    }
  }

  // --- interfaces (observed + implied holders for orphan addresses) ---
  const interfaceKeysByDevice = new Map<string, string[]>();
  for (const candidate of candidates.interfaces) {
    const interfaceId = newId(interfaceIdSchema);
    entityIds[candidate.key] = interfaceId;
    const list = interfaceKeysByDevice.get(candidate.deviceKey) ?? [];
    list.push(candidate.key);
    interfaceKeysByDevice.set(candidate.deviceKey, list);
    const entity = interfaceSchema.parse({
      id: interfaceId,
      projectId,
      deviceId: entityIds[candidate.deviceKey],
      name: candidate.name,
      kind: winningString(candidate.fields, 'kind') ?? 'ethernet',
      lifecycleState: 'observed',
    });
    op({ ...opBase(), kind: 'CreateEntity', payload: { entityType: 'interface', entity } });
  }

  const impliedInterfaceByDevice = new Map<string, string>();
  function interfaceIdFor(deviceKey: string, interfaceName: string | null): string {
    if (interfaceName) {
      const key = `${deviceKey}/iface:${interfaceName}`;
      const known = entityIds[key];
      if (known) return known;
    }
    // fall back to the device's first observed interface, else an implied holder
    const firstKey = interfaceKeysByDevice.get(deviceKey)?.[0];
    if (firstKey) {
      const id = entityIds[firstKey];
      if (id) return id;
    }
    const already = impliedInterfaceByDevice.get(deviceKey);
    if (already) return already;
    const interfaceId = newId(interfaceIdSchema);
    impliedInterfaceByDevice.set(deviceKey, interfaceId);
    entityIds[`${deviceKey}/iface:${IMPLIED_INTERFACE_NAME}`] = interfaceId;
    const entity = interfaceSchema.parse({
      id: interfaceId,
      projectId,
      deviceId: entityIds[deviceKey],
      name: IMPLIED_INTERFACE_NAME,
      kind: 'other',
      lifecycleState: 'inferred',
      notes: 'Auto-created to hold imported addresses with no interface information.',
    });
    op({ ...opBase(), kind: 'CreateEntity', payload: { entityType: 'interface', entity } });
    return interfaceId;
  }

  // --- addresses ---
  for (const candidate of candidates.addresses) {
    const addressId = newId(addressIdSchema);
    entityIds[candidate.key] = addressId;
    const entity = addressSchema.parse({
      id: addressId,
      projectId,
      interfaceId: interfaceIdFor(candidate.deviceKey, candidate.interfaceName),
      kind: candidate.kind,
      value: candidate.value,
      lifecycleState: 'observed',
    });
    op({ ...opBase(), kind: 'CreateEntity', payload: { entityType: 'address', entity } });
  }

  // --- services ---
  for (const candidate of candidates.services) {
    const serviceId = newId(serviceIdSchema);
    entityIds[candidate.key] = serviceId;
    const entity = serviceSchema.parse({
      id: serviceId,
      projectId,
      deviceId: entityIds[candidate.deviceKey],
      name: winningString(candidate.fields, 'name') ?? `${candidate.protocol}/${candidate.port}`,
      protocol: candidate.protocol,
      portStart: candidate.port,
      portEnd: candidate.port,
      process: winningString(candidate.fields, 'process') ?? '',
      description: winningString(candidate.fields, 'description') ?? '',
      lifecycleState: 'observed',
    });
    op({ ...opBase(), kind: 'CreateEntity', payload: { entityType: 'service', entity } });
  }

  // --- identities ---
  for (const candidate of candidates.identities) {
    const identityId = newId(identityIdSchema);
    entityIds[candidate.key] = identityId;
    const hostDeviceId =
      candidate.scope === 'local' ? (entityIds[candidate.deviceKeys[0] ?? ''] ?? null) : null;
    const entity = identitySchema.parse({
      id: identityId,
      projectId,
      scope: candidate.scope,
      name: candidate.name,
      domain: candidate.domain,
      kind: winningString(candidate.fields, 'kind') ?? 'user',
      deviceId: hostDeviceId,
      lifecycleState: 'observed',
    });
    op({ ...opBase(), kind: 'CreateEntity', payload: { entityType: 'identity', entity } });

    const existingKey =
      candidate.scope === 'domain'
        ? `domain:${candidate.domain.toUpperCase()}\\${candidate.name.toLowerCase()}`
        : null;
    const existing = existingKey ? index.identityByKey.get(existingKey) : undefined;
    if (existing) {
      conflicts.push(
        importConflictSchema.parse({
          id: newId(z.uuidv7()),
          candidateKey: candidate.key,
          entityType: 'identity',
          existingEntityId: existing.id,
          summary: `Imported principal "${candidate.domain}\\${candidate.name}" matches existing identity "${existing.name}"`,
          fieldDiffs: [],
          resolution: 'pending',
        }),
      );
    }
  }

  // --- role assignments ---
  for (const candidate of candidates.roleAssignments) {
    const assignmentId = newId(roleAssignmentIdSchema);
    entityIds[candidate.key] = assignmentId;
    const entity = roleAssignmentSchema.parse({
      id: assignmentId,
      projectId,
      identityId: entityIds[candidate.identityKey],
      deviceId: entityIds[candidate.deviceKey] ?? null,
      privilege: candidate.privilege,
      detail: candidate.detail,
      lifecycleState: 'observed',
    });
    op({ ...opBase(), kind: 'CreateEntity', payload: { entityType: 'roleAssignment', entity } });
  }

  // --- flows ---
  const deviceKeyByHint = new Map<string, string>();
  for (const candidate of candidates.devices) {
    for (const mac of candidate.hints.macs) deviceKeyByHint.set(`mac:${mac}`, candidate.key);
    for (const ip of candidate.hints.ips) deviceKeyByHint.set(`ip:${ip}`, candidate.key);
    for (const hostname of candidate.hints.hostnames)
      deviceKeyByHint.set(`hostname:${hostname}`, candidate.key);
  }
  function resolveFlowEndpoint(hints: FlowCandidate['source']): FlowEndpoint {
    // an imported device from this run?
    const candidateKey =
      (hints.mac && deviceKeyByHint.get(`mac:${normalizeMac(hints.mac)}`)) ||
      (hints.ip && deviceKeyByHint.get(`ip:${normalizeIp(hints.ip)}`)) ||
      (hints.hostname && deviceKeyByHint.get(`hostname:${normalizeHostname(hints.hostname)}`));
    if (candidateKey) {
      const id = entityIds[candidateKey];
      if (id) return { kind: 'device', id: deviceIdSchema.parse(id) };
    }
    // a committed device?
    const existing =
      (hints.mac && index.deviceByMac.get(normalizeMac(hints.mac))) ||
      (hints.ip && index.deviceByIp.get(normalizeIp(hints.ip))) ||
      (hints.hostname && index.deviceByHostname.get(normalizeHostname(hints.hostname)));
    if (existing) return { kind: 'device', id: existing.id };
    // an unknown peer stays an address literal — never invent a Device
    return { kind: 'external', value: hints.ip ?? hints.hostname ?? hints.mac ?? 'unknown' };
  }

  for (const candidate of candidates.flows) {
    const flowId = newId(flowIdSchema);
    entityIds[candidate.key] = flowId;
    const source = resolveFlowEndpoint(candidate.source);
    const destination = resolveFlowEndpoint(candidate.destination);
    const serviceId = matchFlowService(candidate, destination, candidates, entityIds, state);
    const entity = flowSchema.parse({
      id: flowId,
      projectId,
      source,
      destination,
      protocol: candidate.protocol,
      port: candidate.port,
      serviceId,
      firstSeen: candidate.firstSeen ?? now,
      lastSeen: candidate.lastSeen ?? now,
      observationCount: candidate.count,
      confidence: candidate.confidence,
      lifecycleState: 'observed',
    });
    op({ ...opBase(), kind: 'CreateEntity', payload: { entityType: 'flow', entity } });

    const existing = index.flowByKey.get(
      `${flowEndpointLabel(source)}->${flowEndpointLabel(destination)}:${candidate.protocol}/${candidate.port ?? 'any'}`,
    );
    if (existing) {
      conflicts.push(
        importConflictSchema.parse({
          id: newId(z.uuidv7()),
          candidateKey: candidate.key,
          entityType: 'flow',
          existingEntityId: existing.id,
          summary: `Imported flow ${candidate.key} matches an existing flow`,
          fieldDiffs: [],
          resolution: 'pending',
        }),
      );
    }
  }

  return importProposalSchema.parse({
    importJobId: job.id,
    projectId,
    changeSetId: newId(changeSetIdSchema),
    label: `Import ${job.parserName} (${job.id.slice(0, 8)})`,
    operations,
    entityIds,
    conflicts,
    updatedAt: now,
  });
}

function matchFlowService(
  candidate: FlowCandidate,
  destination: FlowEndpoint,
  candidates: CandidateSet,
  entityIds: Record<string, string>,
  state: ProjectState,
): string | null {
  if (candidate.port === null || destination.kind !== 'device') return null;
  // a service candidate from this import on the destination device?
  for (const service of candidates.services) {
    if (
      entityIds[service.deviceKey] === destination.id &&
      service.protocol === candidate.protocol &&
      service.port === candidate.port
    ) {
      return entityIds[service.key] ?? null;
    }
  }
  // a committed service?
  const existing = state.services.find(
    (s) =>
      s.deviceId === destination.id &&
      s.protocol === candidate.protocol &&
      s.portStart !== null &&
      s.portEnd !== null &&
      candidate.port !== null &&
      s.portStart <= candidate.port &&
      candidate.port <= s.portEnd,
  );
  return existing?.id ?? null;
}

// ---------------------------------------------------------------------------
// resolutions rewrite the pending ChangeSet (ADR-0021)
// ---------------------------------------------------------------------------

function isEmptyish(value: unknown): boolean {
  return value === '' || value === null || value === undefined;
}

/** Fields on a merged/replaced entity that resolution may rewrite. */
const MERGEABLE_DEVICE_FIELDS = ['name', 'deviceType', 'vendor', 'model', 'os', 'location'];

export function applyResolution(
  proposal: ImportProposal,
  state: ProjectState,
  candidates: CandidateSet,
  conflictId: string,
  action: ImportResolutionAction,
): ImportProposal {
  const conflict = proposal.conflicts.find((c) => c.id === conflictId);
  if (!conflict) throw new Error(`Conflict ${conflictId} not found`);

  const next: ImportProposal = importProposalSchema.parse(JSON.parse(JSON.stringify(proposal)));
  const target = next.conflicts.find((c) => c.id === conflictId);
  if (!target) throw new Error(`Conflict ${conflictId} not found`);
  target.resolution = action;

  if (action === 'keepSeparate') return next;
  if (action === 'ignore') {
    dropCandidate(next, conflict.candidateKey);
    return next;
  }

  // merge / replace
  switch (conflict.entityType) {
    case 'device':
      mergeDevice(next, state, candidates, conflict, action);
      break;
    case 'identity':
      mergeIdentity(next, state, candidates, conflict, action);
      break;
    case 'flow':
      mergeFlow(next, state, candidates, conflict);
      break;
  }
  return next;
}

/** Remove a candidate's Create plus everything that depends on it. */
function dropCandidate(proposal: ImportProposal, candidateKey: string): void {
  const rootId = proposal.entityIds[candidateKey];
  if (!rootId) return;
  const droppedIds = new Set<string>([rootId]);
  // transitively drop creates that reference a dropped id
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of proposal.operations) {
      if (operation.kind !== 'CreateEntity') continue;
      const entity = operation.payload.entity;
      if (droppedIds.has(entity.id)) continue;
      if (referencesAny(operation, droppedIds)) {
        droppedIds.add(entity.id);
        changed = true;
      }
    }
  }
  proposal.operations = proposal.operations.filter(
    (operation) =>
      !(operation.kind === 'CreateEntity' && droppedIds.has(operation.payload.entity.id)),
  );
}

function referencesAny(operation: Operation, ids: Set<string>): boolean {
  if (operation.kind !== 'CreateEntity') return false;
  const entity = recordOf(operation.payload.entity);
  for (const key of ['deviceId', 'interfaceId', 'identityId', 'serviceId']) {
    const value = entity[key];
    if (typeof value === 'string' && ids.has(value)) return true;
  }
  if (operation.payload.entityType === 'flow') {
    const flow = operation.payload.entity;
    for (const endpoint of [flow.source, flow.destination]) {
      if (endpoint.kind !== 'external' && ids.has(endpoint.id)) return true;
    }
  }
  return false;
}

/**
 * Re-point every reference to `fromId` at `toId` inside pending Create ops.
 * UUIDs are globally unique and the Create carrying `fromId` as its own id is
 * removed before this runs, so a textual swap inside the serialized Operation
 * is exact — the re-parse proves the result is still a valid Operation.
 */
function retargetReferences(proposal: ImportProposal, fromId: string, toId: string): void {
  proposal.operations = proposal.operations.map((operation) => {
    if (operation.kind !== 'CreateEntity') return operation;
    const swapped = JSON.stringify(operation).split(fromId).join(toId);
    return operationSchema.parse(JSON.parse(swapped));
  });
}

function removeCreate(proposal: ImportProposal, entityId: string): void {
  proposal.operations = proposal.operations.filter(
    (operation) => !(operation.kind === 'CreateEntity' && operation.payload.entity.id === entityId),
  );
}

function mergeDevice(
  proposal: ImportProposal,
  state: ProjectState,
  candidates: CandidateSet,
  conflict: ImportConflict,
  action: 'merge' | 'replace',
): void {
  const candidate = candidates.devices.find((d) => d.key === conflict.candidateKey);
  const existing = state.devices.find((d) => d.id === conflict.existingEntityId);
  if (!candidate || !existing) throw new Error('Merge target not found');
  const oldId = proposal.entityIds[conflict.candidateKey];
  if (!oldId) throw new Error('Candidate has no pending entity');

  removeCreate(proposal, oldId);
  proposal.entityIds[conflict.candidateKey] = existing.id;

  // rewrite the Create into SetFields on the existing object (ADR-0021)
  const existingRecord = recordOf(existing);
  for (const field of MERGEABLE_DEVICE_FIELDS) {
    const proposed = winning(candidate.fields, field);
    if (proposed === undefined) continue;
    const current = fieldValueSchema.parse(existingRecord[field] ?? null);
    if (JSON.stringify(current) === JSON.stringify(proposed)) continue;
    // merge: imported values fill gaps, existing values win conflicts;
    // replace: imported values win everywhere
    if (action === 'merge' && !isEmptyish(current)) continue;
    proposal.operations.push(
      operationSchema.parse({
        id: newId(operationIdSchema),
        projectId: proposal.projectId,
        kind: 'SetField',
        entityType: 'device',
        entityId: existing.id,
        field,
        value: proposed,
        previousValue: current,
      }),
    );
  }

  retargetReferences(proposal, oldId, existing.id);
  dedupChildrenAgainstExisting(proposal, state, existing.id);
}

/** After a merge, drop pending child Creates that duplicate committed children. */
function dedupChildrenAgainstExisting(
  proposal: ImportProposal,
  state: ProjectState,
  deviceId: string,
): void {
  const existingInterfaces = state.interfaces.filter((i) => i.deviceId === deviceId);
  const existingIfaceByName = new Map(existingInterfaces.map((i) => [i.name.toLowerCase(), i]));
  const existingAddressValues = new Set(
    state.addresses
      .filter((a) => existingInterfaces.some((i) => i.id === a.interfaceId))
      .map((a) => `${a.kind}=${a.value.toLowerCase()}`),
  );
  const existingServices = new Set(
    state.services
      .filter((s) => s.deviceId === deviceId)
      .map((s) => `${s.protocol}/${s.portStart ?? ''}`),
  );
  const existingIdentityNames = new Set(
    state.identities
      .filter((i) => i.deviceId === deviceId)
      .map((i) => `${i.scope}:${i.name.toLowerCase()}`),
  );

  // duplicate interfaces: remap references to the existing interface, drop the create
  for (const operation of [...proposal.operations]) {
    if (operation.kind !== 'CreateEntity' || operation.payload.entityType !== 'interface') continue;
    const iface = operation.payload.entity;
    if (iface.deviceId !== deviceId) continue;
    const existing = existingIfaceByName.get(iface.name.toLowerCase());
    if (!existing) continue;
    removeCreate(proposal, iface.id);
    retargetReferences(proposal, iface.id, existing.id);
    for (const [key, id] of Object.entries(proposal.entityIds)) {
      if (id === iface.id) proposal.entityIds[key] = existing.id;
    }
  }

  const interfaceIdsOfDevice = new Set([
    ...existingInterfaces.map((i) => i.id),
    ...proposal.operations
      .filter(
        (o): o is Operation & { kind: 'CreateEntity' } =>
          o.kind === 'CreateEntity' && o.payload.entityType === 'interface',
      )
      .map((o) => o.payload.entity.id),
  ]);

  proposal.operations = proposal.operations.filter((operation) => {
    if (operation.kind !== 'CreateEntity') return true;
    const payload = operation.payload;
    switch (payload.entityType) {
      case 'address':
        return !(
          interfaceIdsOfDevice.has(payload.entity.interfaceId) &&
          existingAddressValues.has(`${payload.entity.kind}=${payload.entity.value.toLowerCase()}`)
        );
      case 'service':
        return !(
          payload.entity.deviceId === deviceId &&
          existingServices.has(`${payload.entity.protocol}/${payload.entity.portStart ?? ''}`)
        );
      case 'identity':
        return !(
          payload.entity.deviceId === deviceId &&
          existingIdentityNames.has(`${payload.entity.scope}:${payload.entity.name.toLowerCase()}`)
        );
      default:
        return true;
    }
  });
}

function mergeIdentity(
  proposal: ImportProposal,
  state: ProjectState,
  candidates: CandidateSet,
  conflict: ImportConflict,
  action: 'merge' | 'replace',
): void {
  const candidate = candidates.identities.find((i) => i.key === conflict.candidateKey);
  const existing = state.identities.find((i) => i.id === conflict.existingEntityId);
  if (!candidate || !existing) throw new Error('Merge target not found');
  const oldId = proposal.entityIds[conflict.candidateKey];
  if (!oldId) throw new Error('Candidate has no pending entity');

  removeCreate(proposal, oldId);
  proposal.entityIds[conflict.candidateKey] = existing.id;

  const kind = winningString(candidate.fields, 'kind');
  if (kind && kind !== existing.kind && (action === 'replace' || isEmptyish(existing.kind))) {
    proposal.operations.push(
      operationSchema.parse({
        id: newId(operationIdSchema),
        projectId: proposal.projectId,
        kind: 'SetField',
        entityType: 'identity',
        entityId: existing.id,
        field: 'kind',
        value: kind,
        previousValue: existing.kind,
      }),
    );
  }

  retargetReferences(proposal, oldId, existing.id);

  // drop pending role assignments that already exist on the committed identity
  const existingAssignments = new Set(
    state.roleAssignments
      .filter((r) => r.identityId === existing.id)
      .map((r) => `${r.deviceId ?? ''}:${r.privilege}:${r.detail}`),
  );
  proposal.operations = proposal.operations.filter((operation) => {
    if (operation.kind !== 'CreateEntity' || operation.payload.entityType !== 'roleAssignment') {
      return true;
    }
    const assignment = operation.payload.entity;
    return !(
      assignment.identityId === existing.id &&
      existingAssignments.has(
        `${assignment.deviceId ?? ''}:${assignment.privilege}:${assignment.detail}`,
      )
    );
  });
}

function mergeFlow(
  proposal: ImportProposal,
  state: ProjectState,
  candidates: CandidateSet,
  conflict: ImportConflict,
): void {
  const candidate = candidates.flows.find((f) => f.key === conflict.candidateKey);
  const existing = state.flows.find((f) => f.id === conflict.existingEntityId);
  if (!candidate || !existing) throw new Error('Merge target not found');
  const oldId = proposal.entityIds[conflict.candidateKey];
  if (!oldId) throw new Error('Candidate has no pending entity');

  removeCreate(proposal, oldId);
  proposal.entityIds[conflict.candidateKey] = existing.id;

  const setField = (field: string, value: FieldValue, previousValue: FieldValue) =>
    proposal.operations.push(
      operationSchema.parse({
        id: newId(operationIdSchema),
        projectId: proposal.projectId,
        kind: 'SetField',
        entityType: 'flow',
        entityId: existing.id,
        field,
        value,
        previousValue,
      }),
    );

  setField(
    'observationCount',
    existing.observationCount + candidate.count,
    existing.observationCount,
  );
  if (candidate.firstSeen && candidate.firstSeen < existing.firstSeen) {
    setField('firstSeen', candidate.firstSeen, existing.firstSeen);
  }
  if (candidate.lastSeen && candidate.lastSeen > existing.lastSeen) {
    setField('lastSeen', candidate.lastSeen, existing.lastSeen);
  }
}

// ---------------------------------------------------------------------------
// provenance generation (ADR-0008) — written at commit, same transaction
// ---------------------------------------------------------------------------

export function generateProvenanceRows(
  proposal: ImportProposal,
  candidates: CandidateSet,
  observationsById: Map<ObservationId, Observation>,
  job: ImportJob,
  now: string,
): FieldProvenance[] {
  const rows: FieldProvenance[] = [];
  const ignored = new Set(
    proposal.conflicts.filter((c) => c.resolution === 'ignore').map((c) => c.candidateKey),
  );
  const createdIds = new Set<string>(
    proposal.operations
      .filter((o) => o.kind === 'CreateEntity')
      .map((o) => (o.kind === 'CreateEntity' ? o.payload.entity.id : '')),
  );
  const setFields = new Set(
    proposal.operations
      .filter((o) => o.kind === 'SetField')
      .map((o) => (o.kind === 'SetField' ? `${o.entityId}:${o.field}` : '')),
  );

  const projectId: ProjectId = proposal.projectId;

  function emit(
    entityType: FieldProvenance['entityType'],
    entityId: string,
    field: string,
    values: FieldValueCandidate[],
  ): void {
    const applied = createdIds.has(entityId) || setFields.has(`${entityId}:${field}`);
    values.forEach((candidateValue, rank) => {
      const accepted = rank === 0 && applied;
      for (const observationId of candidateValue.observations) {
        const observation = observationsById.get(observationId);
        rows.push({
          id: newId(fieldProvenanceIdSchema),
          projectId,
          entityType,
          entityId,
          field,
          sourceType: 'imported',
          evidenceId: observation?.evidenceId ?? null,
          importJobId: job.id,
          observationId,
          confidence: candidateValue.confidence,
          parserVersion: job.parserVersion,
          status: accepted ? 'accepted' : 'rejected',
          observedValue: candidateValue.value,
          observedAt: observation?.observedAt ?? now,
        });
      }
    });
  }

  const syntheticValue = (
    value: FieldValue,
    confidence: number,
    observations: ObservationId[],
  ): FieldValueCandidate[] => [{ value, confidence, observations }];

  for (const candidate of candidates.devices) {
    if (ignored.has(candidate.key)) continue;
    const entityId = proposal.entityIds[candidate.key];
    if (!entityId) continue;
    for (const [field, values] of Object.entries(candidate.fields)) {
      emit('device', entityId, field, values);
    }
  }
  for (const candidate of candidates.interfaces) {
    if (ignored.has(candidate.deviceKey)) continue;
    const entityId = proposal.entityIds[candidate.key];
    if (!entityId) continue;
    emit(
      'interface',
      entityId,
      'name',
      syntheticValue(candidate.name, candidate.confidence, candidate.observations),
    );
    for (const [field, values] of Object.entries(candidate.fields)) {
      emit('interface', entityId, field, values);
    }
  }
  for (const candidate of candidates.addresses) {
    if (ignored.has(candidate.deviceKey)) continue;
    const entityId = proposal.entityIds[candidate.key];
    if (!entityId) continue;
    emit(
      'address',
      entityId,
      'value',
      syntheticValue(candidate.value, candidate.confidence, candidate.observations),
    );
  }
  for (const candidate of candidates.services) {
    if (ignored.has(candidate.deviceKey)) continue;
    const entityId = proposal.entityIds[candidate.key];
    if (!entityId) continue;
    emit(
      'service',
      entityId,
      'portStart',
      syntheticValue(candidate.port, candidate.confidence, candidate.observations),
    );
    for (const [field, values] of Object.entries(candidate.fields)) {
      emit('service', entityId, field, values);
    }
  }
  for (const candidate of candidates.identities) {
    if (ignored.has(candidate.key)) continue;
    const entityId = proposal.entityIds[candidate.key];
    if (!entityId) continue;
    emit(
      'identity',
      entityId,
      'name',
      syntheticValue(candidate.name, candidate.confidence, candidate.observations),
    );
    for (const [field, values] of Object.entries(candidate.fields)) {
      emit('identity', entityId, field, values);
    }
  }
  for (const candidate of candidates.roleAssignments) {
    if (ignored.has(candidate.key) || ignored.has(candidate.identityKey)) continue;
    const entityId = proposal.entityIds[candidate.key];
    if (!entityId) continue;
    emit(
      'roleAssignment',
      entityId,
      'privilege',
      syntheticValue(candidate.privilege, candidate.confidence, candidate.observations),
    );
  }
  for (const candidate of candidates.flows) {
    if (ignored.has(candidate.key)) continue;
    const entityId = proposal.entityIds[candidate.key];
    if (!entityId) continue;
    emit(
      'flow',
      entityId,
      'observationCount',
      syntheticValue(candidate.count, candidate.confidence, candidate.observations),
    );
  }

  return rows;
}
