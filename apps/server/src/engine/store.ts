import { and, asc, count, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import {
  addressSchema,
  baselineSchema,
  changeSetIdSchema,
  changeSetRecordSchema,
  changeSetSchema,
  deviceSchema,
  endpointResolver,
  findingDispositionSchema,
  findingIdSchema,
  findingStatusSchema,
  flowEndpointSchema,
  flowSchema,
  hostArtifactSchema,
  reportRecordSchema,
  importProfileSchema,
  secretMatchSchema,
  identitySchema,
  interfaceSchema,
  linkSchema,
  networkSchema,
  newId,
  operationIdSchema,
  operationLogEntrySchema,
  operationSchema,
  policyRuleSchema,
  projectSchema,
  projectStateSchema,
  roleAssignmentSchema,
  serviceSchema,
  siteSchema,
  zoneSchema,
  invertOperation,
  type Address,
  type ChangeSet,
  type ChangeSetRecord,
  type Device,
  type Endpoint,
  type EntityPayload,
  type Flow,
  type Identity,
  type Interface,
  type Link,
  type Network,
  type Operation,
  type PolicyRule,
  type Project,
  type ProjectState,
  type RoleAssignment,
  type Service,
  type SettableEntityType,
  type Site,
  type OperationLogEntry,
  type UndoRedoAvailability,
  type Zone,
} from '@netplan/domain';
import type { Db } from '../db/index.js';
import {
  addresses,
  baselines,
  changeSets,
  devices,
  egressAuditRecords,
  egressSettings,
  evidence,
  evidenceBlobs,
  fieldProvenance,
  findingDispositions,
  flows,
  hostArtifacts,
  reports,
  importProfilesTable,
  secretMatches,
  identities,
  importJobs,
  importProposals,
  interfaces,
  links,
  networks,
  observations,
  operationLog,
  policyRules,
  projects,
  roleAssignments,
  services,
  sites,
  threatIntelLocalFeeds,
  zones,
} from '../db/schema.js';

export type OperationErrorCode = 'INVALID' | 'NOT_FOUND' | 'CONFLICT';

export class OperationError extends Error {
  constructor(
    public readonly code: OperationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OperationError';
  }
}

export type { ProjectState, UndoRedoAvailability } from '@netplan/domain';

export interface ApplyResult {
  appliedOperations: Operation[];
  availability: UndoRedoAvailability;
}

/** One wire-shaped log row — the domain schema is the single source (ADR-0017). */
export type LogEntry = OperationLogEntry;

/** Filters for the paged Flow read (#82). ISO timestamps compare as strings. */
export interface FlowQuery {
  /** Entity id or external address literal; matches either end of the flow. */
  endpoint?: string;
  /** Destination port, mirroring the /flows `service` query param. */
  service?: number;
  /** Keep flows still seen at or after this instant (lastSeen >= since). */
  since?: string;
  /** Keep flows first seen at or before this instant (firstSeen <= until). */
  until?: string;
  limit: number;
  offset?: number;
}

export interface FlowPage {
  flows: Flow[];
  /** Size of the whole filtered set, not the page. */
  total: number;
}

export interface SearchResult {
  entityType: Exclude<SettableEntityType, 'project'>;
  entity:
    | Site
    | Zone
    | Device
    | Interface
    | Address
    | Network
    | Link
    | Service
    | PolicyRule
    | Flow
    | Identity
    | RoleAssignment;
}

/** An undoable unit: a single operation or a whole ChangeSet (ADR-0010). */
interface Unit {
  unitId: string;
  changeSetId: string | null;
  ops: Operation[];
}

const settableSchemas = {
  project: projectSchema,
  site: siteSchema,
  zone: zoneSchema,
  device: deviceSchema,
  interface: interfaceSchema,
  address: addressSchema,
  network: networkSchema,
  link: linkSchema,
  service: serviceSchema,
  policyRule: policyRuleSchema,
  flow: flowSchema,
  hostArtifact: hostArtifactSchema,
  report: reportRecordSchema,
  importProfile: importProfileSchema,
  secretMatch: secretMatchSchema,
  identity: identitySchema,
  roleAssignment: roleAssignmentSchema,
  baseline: baselineSchema,
};

/** Fields that reference another entity, checked on SetField (ADR-0012 note). */
const referenceFields: Partial<
  Record<
    SettableEntityType,
    Record<string, 'site' | 'zone' | 'device' | 'interface' | 'network' | 'service' | 'identity'>
  >
> = {
  zone: { siteId: 'site' },
  device: { zoneId: 'zone' },
  interface: { deviceId: 'device', networkId: 'network' },
  address: { interfaceId: 'interface' },
  service: { deviceId: 'device' },
  policyRule: { serviceId: 'service' },
  flow: { serviceId: 'service' },
  hostArtifact: { deviceId: 'device' },
  identity: { deviceId: 'device' },
  roleAssignment: { identityId: 'identity', deviceId: 'device' },
};

export type EngineTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type Engine = ReturnType<typeof createEngine>;

export function createEngine(db: Db) {
  // ---------- plain reads ----------

  function getProject(projectId: string): Project | undefined {
    const row = db.select().from(projects).where(eq(projects.id, projectId)).get();
    return row ? projectSchema.parse(row) : undefined;
  }

  function requireProject(projectId: string): Project {
    const project = getProject(projectId);
    if (!project) throw new OperationError('NOT_FOUND', `Project ${projectId} not found`);
    return project;
  }

  /**
   * The full project snapshot. `omitFlows` skips the Flow load entirely
   * (ADR-0019 scale, #82): at the ~5k-flow tier the graph read must not
   * materialize flows it is about to drop — callers page them via queryFlows.
   */
  function getState(projectId: string, options?: { omitFlows?: boolean }): ProjectState {
    const project = requireProject(projectId);
    return {
      project,
      sites: db
        .select()
        .from(sites)
        .where(eq(sites.projectId, projectId))
        .orderBy(asc(sites.id))
        .all()
        .map((r) => siteSchema.parse(r)),
      zones: db
        .select()
        .from(zones)
        .where(eq(zones.projectId, projectId))
        .orderBy(asc(zones.id))
        .all()
        .map((r) => zoneSchema.parse(r)),
      devices: db
        .select()
        .from(devices)
        .where(eq(devices.projectId, projectId))
        .orderBy(asc(devices.id))
        .all()
        .map((r) => deviceSchema.parse(r)),
      interfaces: db
        .select()
        .from(interfaces)
        .where(eq(interfaces.projectId, projectId))
        .orderBy(asc(interfaces.id))
        .all()
        .map((r) => interfaceSchema.parse(r)),
      addresses: db
        .select()
        .from(addresses)
        .where(eq(addresses.projectId, projectId))
        .orderBy(asc(addresses.id))
        .all()
        .map((r) => addressSchema.parse(r)),
      networks: db
        .select()
        .from(networks)
        .where(eq(networks.projectId, projectId))
        .orderBy(asc(networks.id))
        .all()
        .map((r) => networkSchema.parse(r)),
      links: db
        .select()
        .from(links)
        .where(eq(links.projectId, projectId))
        .orderBy(asc(links.id))
        .all()
        .map((r) => linkSchema.parse(r)),
      services: db
        .select()
        .from(services)
        .where(eq(services.projectId, projectId))
        .orderBy(asc(services.id))
        .all()
        .map((r) => serviceSchema.parse(r)),
      policyRules: db
        .select()
        .from(policyRules)
        .where(eq(policyRules.projectId, projectId))
        .orderBy(asc(policyRules.id))
        .all()
        .map((r) => policyRuleSchema.parse(r)),
      flows: options?.omitFlows
        ? []
        : db
            .select()
            .from(flows)
            .where(eq(flows.projectId, projectId))
            .orderBy(asc(flows.id))
            .all()
            .map((r) => flowSchema.parse(r)),
      hostArtifacts: db
        .select()
        .from(hostArtifacts)
        .where(eq(hostArtifacts.projectId, projectId))
        .orderBy(asc(hostArtifacts.id))
        .all()
        .map((r) => hostArtifactSchema.parse(r)),
      reports: db
        .select()
        .from(reports)
        .where(eq(reports.projectId, projectId))
        .orderBy(asc(reports.id))
        .all()
        .map((r) => reportRecordSchema.parse(r)),
      importProfiles: db
        .select()
        .from(importProfilesTable)
        .where(eq(importProfilesTable.projectId, projectId))
        .orderBy(asc(importProfilesTable.id))
        .all()
        .map((r) => importProfileSchema.parse(r)),
      secretMatches: db
        .select()
        .from(secretMatches)
        .where(eq(secretMatches.projectId, projectId))
        .orderBy(asc(secretMatches.id))
        .all()
        .map((r) => secretMatchSchema.parse(r)),
      identities: db
        .select()
        .from(identities)
        .where(eq(identities.projectId, projectId))
        .orderBy(asc(identities.id))
        .all()
        .map((r) => identitySchema.parse(r)),
      roleAssignments: db
        .select()
        .from(roleAssignments)
        .where(eq(roleAssignments.projectId, projectId))
        .orderBy(asc(roleAssignments.id))
        .all()
        .map((r) => roleAssignmentSchema.parse(r)),
      findingDispositions: db
        .select()
        .from(findingDispositions)
        .where(eq(findingDispositions.projectId, projectId))
        .orderBy(asc(findingDispositions.id))
        .all()
        .map((r) => findingDispositionSchema.parse(r)),
      baselines: db
        .select()
        .from(baselines)
        .where(eq(baselines.projectId, projectId))
        .orderBy(asc(baselines.id))
        .all()
        .map((r) => baselineSchema.parse(r)),
    };
  }

  /**
   * Paged Flow read (#82, advancing ADR-0019): filtering, endpoint matching
   * and slicing run in the database, so memory never scales with the
   * project's total Flow count. The endpoint predicate — "either end of the
   * flow is this entity id or this external address literal" — lives here and
   * nowhere else; routes and future consumers (exports, findings) delegate.
   */
  function queryFlows(projectId: string, query: FlowQuery): FlowPage {
    requireProject(projectId);
    const conditions = [eq(flows.projectId, projectId)];
    if (query.endpoint !== undefined) {
      // Entity endpoints carry `id`, external literals carry `value` — the
      // stored JSON never has both, so probing each key mirrors the kind check.
      conditions.push(
        or(
          sql`json_extract(${flows.source}, '$.id') = ${query.endpoint}`,
          sql`json_extract(${flows.source}, '$.value') = ${query.endpoint}`,
          sql`json_extract(${flows.destination}, '$.id') = ${query.endpoint}`,
          sql`json_extract(${flows.destination}, '$.value') = ${query.endpoint}`,
        )!,
      );
    }
    if (query.service !== undefined) conditions.push(eq(flows.port, query.service));
    if (query.since !== undefined) conditions.push(gte(flows.lastSeen, query.since));
    if (query.until !== undefined) conditions.push(lte(flows.firstSeen, query.until));
    const where = and(...conditions);
    const total = db.select({ total: count() }).from(flows).where(where).get()?.total ?? 0;
    const page = db
      .select()
      .from(flows)
      .where(where)
      .orderBy(asc(flows.id))
      .limit(query.limit)
      .offset(query.offset ?? 0)
      .all()
      .map((r) => flowSchema.parse(r));
    return { flows: page, total };
  }

  function getLog(projectId: string): LogEntry[] {
    return db
      .select()
      .from(operationLog)
      .where(eq(operationLog.projectId, projectId))
      .orderBy(asc(operationLog.seq))
      .all()
      .map((row) => operationLogEntrySchema.parse(row));
  }

  /**
   * The project's version watermark (improvements M14, #71): the highest
   * operation-log seq. Cheap — one MAX, no row scan — so mutation responses
   * and the findings cache can key on it instead of the whole ProjectState.
   */
  function getWatermark(projectId: string): number {
    const row = db
      .select({ seq: operationLog.seq })
      .from(operationLog)
      .where(eq(operationLog.projectId, projectId))
      .orderBy(desc(operationLog.seq))
      .limit(1)
      .get();
    return row?.seq ?? 0;
  }

  // ---------- project CRUD (workspace bootstrap; entities go through Operations) ----------

  function createProject(project: Project): Project {
    const parsed = projectSchema.parse(project);
    if (getProject(parsed.id)) throw new OperationError('CONFLICT', 'Project already exists');
    db.insert(projects).values(parsed).run();
    return parsed;
  }

  function listProjects(): Project[] {
    return db
      .select()
      .from(projects)
      .orderBy(asc(projects.id))
      .all()
      .map((r) => projectSchema.parse(r));
  }

  function deleteProject(projectId: string): void {
    requireProject(projectId);
    db.transaction((tx) => {
      const evidenceIds = tx
        .select({ id: evidence.id })
        .from(evidence)
        .where(eq(evidence.projectId, projectId))
        .all()
        .map((r) => r.id);
      for (const evidenceId of evidenceIds) {
        tx.delete(evidenceBlobs).where(eq(evidenceBlobs.evidenceId, evidenceId)).run();
      }
      tx.delete(observations).where(eq(observations.projectId, projectId)).run();
      tx.delete(importProposals).where(eq(importProposals.projectId, projectId)).run();
      tx.delete(evidence).where(eq(evidence.projectId, projectId)).run();
      tx.delete(importJobs).where(eq(importJobs.projectId, projectId)).run();
      tx.delete(fieldProvenance).where(eq(fieldProvenance.projectId, projectId)).run();
      tx.delete(findingDispositions).where(eq(findingDispositions.projectId, projectId)).run();
      tx.delete(baselines).where(eq(baselines.projectId, projectId)).run();
      tx.delete(operationLog).where(eq(operationLog.projectId, projectId)).run();
      tx.delete(changeSets).where(eq(changeSets.projectId, projectId)).run();
      tx.delete(roleAssignments).where(eq(roleAssignments.projectId, projectId)).run();
      tx.delete(identities).where(eq(identities.projectId, projectId)).run();
      tx.delete(reports).where(eq(reports.projectId, projectId)).run();
      tx.delete(importProfilesTable).where(eq(importProfilesTable.projectId, projectId)).run();
      tx.delete(secretMatches).where(eq(secretMatches.projectId, projectId)).run();
      tx.delete(hostArtifacts).where(eq(hostArtifacts.projectId, projectId)).run();
      tx.delete(flows).where(eq(flows.projectId, projectId)).run();
      tx.delete(policyRules).where(eq(policyRules.projectId, projectId)).run();
      tx.delete(links).where(eq(links.projectId, projectId)).run();
      tx.delete(services).where(eq(services.projectId, projectId)).run();
      tx.delete(addresses).where(eq(addresses.projectId, projectId)).run();
      tx.delete(interfaces).where(eq(interfaces.projectId, projectId)).run();
      tx.delete(devices).where(eq(devices.projectId, projectId)).run();
      tx.delete(networks).where(eq(networks.projectId, projectId)).run();
      tx.delete(zones).where(eq(zones.projectId, projectId)).run();
      tx.delete(sites).where(eq(sites.projectId, projectId)).run();
      // Phase-4 sidecars: egress door state, audit trail, local threat-intel feed
      tx.delete(egressAuditRecords).where(eq(egressAuditRecords.projectId, projectId)).run();
      tx.delete(egressSettings).where(eq(egressSettings.projectId, projectId)).run();
      tx.delete(threatIntelLocalFeeds).where(eq(threatIntelLocalFeeds.projectId, projectId)).run();
      tx.delete(projects).where(eq(projects.id, projectId)).run();
    });
  }

  // ---------- shared checks ----------

  type Tx = EngineTx;

  function exists(
    tx: Tx,
    kind: 'site' | 'zone' | 'device' | 'interface' | 'network' | 'service' | 'identity',
    projectId: string,
    id: string,
  ): boolean {
    switch (kind) {
      case 'identity':
        return !!tx
          .select({ id: identities.id })
          .from(identities)
          .where(and(eq(identities.id, id), eq(identities.projectId, projectId)))
          .get();
      case 'site':
        return !!tx
          .select({ id: sites.id })
          .from(sites)
          .where(and(eq(sites.id, id), eq(sites.projectId, projectId)))
          .get();
      case 'zone':
        return !!tx
          .select({ id: zones.id })
          .from(zones)
          .where(and(eq(zones.id, id), eq(zones.projectId, projectId)))
          .get();
      case 'device':
        return !!tx
          .select({ id: devices.id })
          .from(devices)
          .where(and(eq(devices.id, id), eq(devices.projectId, projectId)))
          .get();
      case 'interface':
        return !!tx
          .select({ id: interfaces.id })
          .from(interfaces)
          .where(and(eq(interfaces.id, id), eq(interfaces.projectId, projectId)))
          .get();
      case 'network':
        return !!tx
          .select({ id: networks.id })
          .from(networks)
          .where(and(eq(networks.id, id), eq(networks.projectId, projectId)))
          .get();
      case 'service':
        return !!tx
          .select({ id: services.id })
          .from(services)
          .where(and(eq(services.id, id), eq(services.projectId, projectId)))
          .get();
    }
  }

  function requireEndpoint(tx: Tx, projectId: string, endpoint: Endpoint, role: string): void {
    const kind = endpoint.kind === 'subnet' ? 'network' : endpoint.kind;
    if (!exists(tx, kind, projectId, endpoint.id)) {
      throw new OperationError(
        'INVALID',
        `${role} endpoint ${endpoint.kind}:${endpoint.id} does not exist in project`,
      );
    }
  }

  /** Flow endpoints may be `external` address literals — nothing to check for those. */
  function requireFlowEndpoint(
    tx: Tx,
    projectId: string,
    endpoint: Flow['source'],
    role: string,
  ): void {
    if (endpoint.kind === 'external') return;
    requireEndpoint(tx, projectId, endpoint, role);
  }

  function requireRef(
    tx: Tx,
    projectId: string,
    kind: 'site' | 'zone' | 'device' | 'interface' | 'network' | 'service' | 'identity',
    id: string | null | undefined,
    label: string,
  ): void {
    if (id == null) return;
    if (!exists(tx, kind, projectId, id)) {
      throw new OperationError('INVALID', `${label} references missing ${kind} ${id}`);
    }
  }

  function checkCreateReferences(tx: Tx, payload: EntityPayload): void {
    switch (payload.entityType) {
      case 'site':
        return;
      case 'zone':
        return requireRef(tx, payload.entity.projectId, 'site', payload.entity.siteId, 'Zone');
      case 'device':
        return requireRef(tx, payload.entity.projectId, 'zone', payload.entity.zoneId, 'Device');
      case 'interface':
        requireRef(tx, payload.entity.projectId, 'device', payload.entity.deviceId, 'Interface');
        requireRef(tx, payload.entity.projectId, 'network', payload.entity.networkId, 'Interface');
        return;
      case 'address':
        return requireRef(
          tx,
          payload.entity.projectId,
          'interface',
          payload.entity.interfaceId,
          'Address',
        );
      case 'network':
        return;
      case 'service':
        return requireRef(
          tx,
          payload.entity.projectId,
          'device',
          payload.entity.deviceId,
          'Service',
        );
      case 'hostArtifact':
        return requireRef(
          tx,
          payload.entity.projectId,
          'device',
          payload.entity.deviceId,
          'HostArtifact',
        );
      case 'report':
      case 'importProfile':
      case 'secretMatch':
        return;
      case 'flow':
        requireFlowEndpoint(tx, payload.entity.projectId, payload.entity.source, 'Flow source');
        requireFlowEndpoint(
          tx,
          payload.entity.projectId,
          payload.entity.destination,
          'Flow destination',
        );
        requireRef(tx, payload.entity.projectId, 'service', payload.entity.serviceId, 'Flow');
        return;
      case 'identity':
        return requireRef(
          tx,
          payload.entity.projectId,
          'device',
          payload.entity.deviceId,
          'Identity',
        );
      case 'roleAssignment':
        requireRef(
          tx,
          payload.entity.projectId,
          'identity',
          payload.entity.identityId,
          'RoleAssignment',
        );
        requireRef(
          tx,
          payload.entity.projectId,
          'device',
          payload.entity.deviceId,
          'RoleAssignment',
        );
        return;
      case 'baseline':
        return requireRef(
          tx,
          payload.entity.projectId,
          payload.entity.scope.kind,
          payload.entity.scope.id,
          'Baseline scope',
        );
    }
  }

  /** Reject deletes that would orphan references (ADR-0012 cleanup rule: clients cascade explicitly). */
  function checkNoDependents(tx: Tx, projectId: string, entityType: string, id: string): void {
    const fail = (what: string) => {
      throw new OperationError(
        'CONFLICT',
        `Cannot delete ${entityType} ${id}: ${what} still references it`,
      );
    };
    const projectLinks = () => tx.select().from(links).where(eq(links.projectId, projectId)).all();
    const projectRules = () =>
      tx.select().from(policyRules).where(eq(policyRules.projectId, projectId)).all();
    const ruleTouches = (kinds: Endpoint['kind'][]) =>
      projectRules().some((r) =>
        [r.source, r.destination].some((e) => kinds.includes(e.kind) && e.id === id),
      );
    const flowTouches = (kinds: Endpoint['kind'][]) =>
      tx
        .select()
        .from(flows)
        .where(eq(flows.projectId, projectId))
        .all()
        .some((f) =>
          [f.source, f.destination].some(
            (e) => e.kind !== 'external' && kinds.includes(e.kind) && e.id === id,
          ),
        );

    switch (entityType) {
      case 'site':
        if (tx.select({ id: zones.id }).from(zones).where(eq(zones.siteId, id)).get())
          fail('a Zone');
        return;
      case 'zone':
        if (tx.select({ id: devices.id }).from(devices).where(eq(devices.zoneId, id)).get())
          fail('a Device');
        if (ruleTouches(['zone'])) fail('a PolicyRule');
        if (flowTouches(['zone'])) fail('a Flow');
        return;
      case 'device':
        if (
          tx.select({ id: interfaces.id }).from(interfaces).where(eq(interfaces.deviceId, id)).get()
        )
          fail('an Interface');
        if (tx.select({ id: services.id }).from(services).where(eq(services.deviceId, id)).get())
          fail('a Service');
        if (ruleTouches(['device'])) fail('a PolicyRule');
        if (flowTouches(['device'])) fail('a Flow');
        if (
          tx.select({ id: identities.id }).from(identities).where(eq(identities.deviceId, id)).get()
        )
          fail('an Identity');
        if (
          tx
            .select({ id: roleAssignments.id })
            .from(roleAssignments)
            .where(eq(roleAssignments.deviceId, id))
            .get()
        )
          fail('a RoleAssignment');
        if (
          tx
            .select({ id: hostArtifacts.id })
            .from(hostArtifacts)
            .where(eq(hostArtifacts.deviceId, id))
            .get()
        )
          fail('a HostArtifact');
        return;
      case 'interface':
        if (
          tx.select({ id: addresses.id }).from(addresses).where(eq(addresses.interfaceId, id)).get()
        )
          fail('an Address');
        if (projectLinks().some((l) => l.source.id === id || l.target.id === id)) fail('a Link');
        if (ruleTouches(['interface'])) fail('a PolicyRule');
        if (flowTouches(['interface'])) fail('a Flow');
        return;
      case 'identity':
        if (
          tx
            .select({ id: roleAssignments.id })
            .from(roleAssignments)
            .where(eq(roleAssignments.identityId, id))
            .get()
        )
          fail('a RoleAssignment');
        return;
      case 'network':
        if (
          tx
            .select({ id: interfaces.id })
            .from(interfaces)
            .where(eq(interfaces.networkId, id))
            .get()
        )
          fail('an Interface membership');
        if (ruleTouches(['network', 'subnet'])) fail('a PolicyRule');
        if (flowTouches(['network', 'subnet'])) fail('a Flow');
        return;
      case 'service':
        if (
          tx
            .select({ id: policyRules.id })
            .from(policyRules)
            .where(eq(policyRules.serviceId, id))
            .get()
        )
          fail('a PolicyRule');
        if (tx.select({ id: flows.id }).from(flows).where(eq(flows.serviceId, id)).get())
          fail('a Flow');
        return;
      default:
        return;
    }
  }

  // ---------- entity table plumbing (monomorphic per type; only apply() calls these) ----------

  function insertEntity(tx: Tx, payload: EntityPayload): void {
    switch (payload.entityType) {
      case 'site':
        return void tx.insert(sites).values(payload.entity).run();
      case 'zone':
        return void tx.insert(zones).values(payload.entity).run();
      case 'device':
        return void tx.insert(devices).values(payload.entity).run();
      case 'interface':
        return void tx.insert(interfaces).values(payload.entity).run();
      case 'address':
        return void tx.insert(addresses).values(payload.entity).run();
      case 'network':
        return void tx.insert(networks).values(payload.entity).run();
      case 'service':
        return void tx.insert(services).values(payload.entity).run();
      case 'flow':
        return void tx.insert(flows).values(payload.entity).run();
      case 'hostArtifact':
        return void tx.insert(hostArtifacts).values(payload.entity).run();
      case 'report':
        return void tx.insert(reports).values(payload.entity).run();
      case 'importProfile':
        return void tx.insert(importProfilesTable).values(payload.entity).run();
      case 'secretMatch':
        return void tx.insert(secretMatches).values(payload.entity).run();
      case 'identity':
        return void tx.insert(identities).values(payload.entity).run();
      case 'roleAssignment':
        return void tx.insert(roleAssignments).values(payload.entity).run();
      case 'baseline':
        return void tx.insert(baselines).values(payload.entity).run();
    }
  }

  function deleteEntityRow(tx: Tx, entityType: EntityPayload['entityType'], id: string): void {
    switch (entityType) {
      case 'site':
        return void tx.delete(sites).where(eq(sites.id, id)).run();
      case 'zone':
        return void tx.delete(zones).where(eq(zones.id, id)).run();
      case 'device':
        return void tx.delete(devices).where(eq(devices.id, id)).run();
      case 'interface':
        return void tx.delete(interfaces).where(eq(interfaces.id, id)).run();
      case 'address':
        return void tx.delete(addresses).where(eq(addresses.id, id)).run();
      case 'network':
        return void tx.delete(networks).where(eq(networks.id, id)).run();
      case 'service':
        return void tx.delete(services).where(eq(services.id, id)).run();
      case 'flow':
        return void tx.delete(flows).where(eq(flows.id, id)).run();
      case 'hostArtifact':
        return void tx.delete(hostArtifacts).where(eq(hostArtifacts.id, id)).run();
      case 'report':
        return void tx.delete(reports).where(eq(reports.id, id)).run();
      case 'importProfile':
        return void tx.delete(importProfilesTable).where(eq(importProfilesTable.id, id)).run();
      case 'secretMatch':
        return void tx.delete(secretMatches).where(eq(secretMatches.id, id)).run();
      case 'identity':
        return void tx.delete(identities).where(eq(identities.id, id)).run();
      case 'roleAssignment':
        return void tx.delete(roleAssignments).where(eq(roleAssignments.id, id)).run();
      case 'baseline':
        return void tx.delete(baselines).where(eq(baselines.id, id)).run();
    }
  }

  function readSettable(
    tx: Tx,
    entityType: SettableEntityType,
    id: string,
  ): Record<string, unknown> | undefined {
    switch (entityType) {
      case 'project':
        return tx.select().from(projects).where(eq(projects.id, id)).get();
      case 'site':
        return tx.select().from(sites).where(eq(sites.id, id)).get();
      case 'zone':
        return tx.select().from(zones).where(eq(zones.id, id)).get();
      case 'device':
        return tx.select().from(devices).where(eq(devices.id, id)).get();
      case 'interface':
        return tx.select().from(interfaces).where(eq(interfaces.id, id)).get();
      case 'address':
        return tx.select().from(addresses).where(eq(addresses.id, id)).get();
      case 'network':
        return tx.select().from(networks).where(eq(networks.id, id)).get();
      case 'link':
        return tx.select().from(links).where(eq(links.id, id)).get();
      case 'service':
        return tx.select().from(services).where(eq(services.id, id)).get();
      case 'policyRule':
        return tx.select().from(policyRules).where(eq(policyRules.id, id)).get();
      case 'flow':
        return tx.select().from(flows).where(eq(flows.id, id)).get();
      case 'hostArtifact':
        return tx.select().from(hostArtifacts).where(eq(hostArtifacts.id, id)).get();
      case 'report':
        return tx.select().from(reports).where(eq(reports.id, id)).get();
      case 'importProfile':
        return tx.select().from(importProfilesTable).where(eq(importProfilesTable.id, id)).get();
      case 'secretMatch':
        return tx.select().from(secretMatches).where(eq(secretMatches.id, id)).get();
      case 'identity':
        return tx.select().from(identities).where(eq(identities.id, id)).get();
      case 'roleAssignment':
        return tx.select().from(roleAssignments).where(eq(roleAssignments.id, id)).get();
      case 'baseline':
        return tx.select().from(baselines).where(eq(baselines.id, id)).get();
    }
  }

  /** Validates `candidate` against the entity schema for its type, then writes the whole row. */
  function writeSettable(
    tx: Tx,
    entityType: SettableEntityType,
    id: string,
    candidate: unknown,
  ): void {
    switch (entityType) {
      case 'project':
        return void tx
          .update(projects)
          .set(projectSchema.parse(candidate))
          .where(eq(projects.id, id))
          .run();
      case 'site':
        return void tx.update(sites).set(siteSchema.parse(candidate)).where(eq(sites.id, id)).run();
      case 'zone':
        return void tx.update(zones).set(zoneSchema.parse(candidate)).where(eq(zones.id, id)).run();
      case 'device':
        return void tx
          .update(devices)
          .set(deviceSchema.parse(candidate))
          .where(eq(devices.id, id))
          .run();
      case 'interface':
        return void tx
          .update(interfaces)
          .set(interfaceSchema.parse(candidate))
          .where(eq(interfaces.id, id))
          .run();
      case 'address':
        return void tx
          .update(addresses)
          .set(addressSchema.parse(candidate))
          .where(eq(addresses.id, id))
          .run();
      case 'network':
        return void tx
          .update(networks)
          .set(networkSchema.parse(candidate))
          .where(eq(networks.id, id))
          .run();
      case 'link':
        return void tx.update(links).set(linkSchema.parse(candidate)).where(eq(links.id, id)).run();
      case 'service':
        return void tx
          .update(services)
          .set(serviceSchema.parse(candidate))
          .where(eq(services.id, id))
          .run();
      case 'policyRule':
        return void tx
          .update(policyRules)
          .set(policyRuleSchema.parse(candidate))
          .where(eq(policyRules.id, id))
          .run();
      case 'flow':
        return void tx.update(flows).set(flowSchema.parse(candidate)).where(eq(flows.id, id)).run();
      case 'hostArtifact':
        return void tx
          .update(hostArtifacts)
          .set(hostArtifactSchema.parse(candidate))
          .where(eq(hostArtifacts.id, id))
          .run();
      case 'report':
        return void tx
          .update(reports)
          .set(reportRecordSchema.parse(candidate))
          .where(eq(reports.id, id))
          .run();
      case 'importProfile':
        return void tx
          .update(importProfilesTable)
          .set(importProfileSchema.parse(candidate))
          .where(eq(importProfilesTable.id, id))
          .run();
      case 'secretMatch':
        return void tx
          .update(secretMatches)
          .set(secretMatchSchema.parse(candidate))
          .where(eq(secretMatches.id, id))
          .run();
      case 'identity':
        return void tx
          .update(identities)
          .set(identitySchema.parse(candidate))
          .where(eq(identities.id, id))
          .run();
      case 'roleAssignment':
        return void tx
          .update(roleAssignments)
          .set(roleAssignmentSchema.parse(candidate))
          .where(eq(roleAssignments.id, id))
          .run();
      case 'baseline':
        return void tx
          .update(baselines)
          .set(baselineSchema.parse(candidate))
          .where(eq(baselines.id, id))
          .run();
    }
  }

  // ---------- the apply core (ADR-0010: the only mutation path for entities) ----------

  function applyOne(tx: Tx, op: Operation): Operation {
    switch (op.kind) {
      case 'CreateEntity': {
        const { entityType, entity } = op.payload;
        if (entity.projectId !== op.projectId) {
          throw new OperationError(
            'INVALID',
            'Entity projectId does not match operation projectId',
          );
        }
        if (readSettable(tx, entityType, entity.id)) {
          throw new OperationError('CONFLICT', `${entityType} ${entity.id} already exists`);
        }
        checkCreateReferences(tx, op.payload);
        insertEntity(tx, op.payload);
        return op;
      }
      case 'DeleteEntity': {
        const { entityType, entity } = op.payload;
        const row = readSettable(tx, entityType, entity.id);
        if (!row) throw new OperationError('NOT_FOUND', `${entityType} ${entity.id} not found`);
        checkNoDependents(tx, op.projectId, entityType, entity.id);
        const payload = entityPayloadFromRow(entityType, row);
        deleteEntityRow(tx, entityType, entity.id);
        return { ...op, payload };
      }
      case 'SetField': {
        if (op.field === 'id' || op.field === 'projectId') {
          throw new OperationError('INVALID', `Field ${op.field} is immutable`);
        }
        const schema = settableSchemas[op.entityType];
        if (!(op.field in schema.shape)) {
          throw new OperationError('INVALID', `${op.entityType} has no field ${op.field}`);
        }
        const row = readSettable(tx, op.entityType, op.entityId);
        if (!row)
          throw new OperationError('NOT_FOUND', `${op.entityType} ${op.entityId} not found`);
        const refKind = referenceFields[op.entityType]?.[op.field];
        if (refKind && typeof op.value === 'string') {
          requireRef(tx, op.projectId, refKind, op.value, op.entityType);
        }
        if (op.entityType === 'link' && (op.field === 'source' || op.field === 'target')) {
          const parsed = linkSchema.shape.source.safeParse(op.value);
          if (!parsed.success)
            throw new OperationError('INVALID', 'Link endpoints must be interfaces');
          requireEndpoint(tx, op.projectId, parsed.data, 'Link');
        }
        if (
          op.entityType === 'policyRule' &&
          (op.field === 'source' || op.field === 'destination')
        ) {
          const parsed = policyRuleSchema.shape.source.safeParse(op.value);
          if (!parsed.success) throw new OperationError('INVALID', 'Invalid PolicyRule endpoint');
          requireEndpoint(tx, op.projectId, parsed.data, 'PolicyRule');
        }
        if (op.entityType === 'flow' && (op.field === 'source' || op.field === 'destination')) {
          const parsed = flowEndpointSchema.safeParse(op.value);
          if (!parsed.success) throw new OperationError('INVALID', 'Invalid Flow endpoint');
          requireFlowEndpoint(tx, op.projectId, parsed.data, 'Flow');
        }
        const previousValue = toJsonValue(row[op.field]);
        const candidate = { ...row, [op.field]: op.value };
        const checked = schema.safeParse(candidate);
        if (!checked.success) {
          throw new OperationError(
            'INVALID',
            `Invalid value for ${op.entityType}.${op.field}: ${checked.error.message}`,
          );
        }
        writeSettable(tx, op.entityType, op.entityId, candidate);
        return { ...op, previousValue };
      }
      case 'CreateLink': {
        if (op.link.projectId !== op.projectId) {
          throw new OperationError('INVALID', 'Link projectId does not match operation projectId');
        }
        if (readSettable(tx, 'link', op.link.id)) {
          throw new OperationError('CONFLICT', `Link ${op.link.id} already exists`);
        }
        requireEndpoint(tx, op.projectId, op.link.source, 'Link source');
        requireEndpoint(tx, op.projectId, op.link.target, 'Link target');
        tx.insert(links).values(op.link).run();
        return op;
      }
      case 'DeleteLink': {
        const row = tx.select().from(links).where(eq(links.id, op.linkId)).get();
        if (!row) throw new OperationError('NOT_FOUND', `Link ${op.linkId} not found`);
        const snapshot = linkSchema.parse(row);
        tx.delete(links).where(eq(links.id, op.linkId)).run();
        return { ...op, snapshot };
      }
      case 'CreatePolicyRule': {
        if (op.rule.projectId !== op.projectId) {
          throw new OperationError(
            'INVALID',
            'PolicyRule projectId does not match operation projectId',
          );
        }
        if (readSettable(tx, 'policyRule', op.rule.id)) {
          throw new OperationError('CONFLICT', `PolicyRule ${op.rule.id} already exists`);
        }
        requireEndpoint(tx, op.projectId, op.rule.source, 'PolicyRule source');
        requireEndpoint(tx, op.projectId, op.rule.destination, 'PolicyRule destination');
        requireRef(tx, op.projectId, 'service', op.rule.serviceId, 'PolicyRule');
        tx.insert(policyRules).values(op.rule).run();
        return op;
      }
      case 'DeletePolicyRule': {
        const row = tx.select().from(policyRules).where(eq(policyRules.id, op.ruleId)).get();
        if (!row) throw new OperationError('NOT_FOUND', `PolicyRule ${op.ruleId} not found`);
        const snapshot = policyRuleSchema.parse(row);
        tx.delete(policyRules).where(eq(policyRules.id, op.ruleId)).run();
        return { ...op, snapshot };
      }
      case 'SetMembership': {
        const row = tx.select().from(interfaces).where(eq(interfaces.id, op.interfaceId)).get();
        if (!row) throw new OperationError('NOT_FOUND', `Interface ${op.interfaceId} not found`);
        requireRef(tx, op.projectId, 'network', op.networkId, 'Membership');
        const previous = interfaceSchema.parse(row);
        tx.update(interfaces)
          .set({ networkId: op.networkId })
          .where(eq(interfaces.id, op.interfaceId))
          .run();
        return { ...op, previousNetworkId: previous.networkId };
      }
      case 'SetContainment': {
        const row = tx.select().from(devices).where(eq(devices.id, op.deviceId)).get();
        if (!row) throw new OperationError('NOT_FOUND', `Device ${op.deviceId} not found`);
        requireRef(tx, op.projectId, 'zone', op.zoneId, 'Containment');
        const previous = deviceSchema.parse(row);
        tx.update(devices).set({ zoneId: op.zoneId }).where(eq(devices.id, op.deviceId)).run();
        return { ...op, previousZoneId: previous.zoneId };
      }
      case 'SetFindingStatus': {
        const existing = findDisposition(tx, op.projectId, op.fingerprint);
        if (existing) {
          const previousStatus = findingStatusSchema.parse(existing.status);
          tx.update(findingDispositions)
            .set({ status: op.status })
            .where(eq(findingDispositions.id, existing.id))
            .run();
          return { ...op, previousStatus };
        }
        // First disposition of this fingerprint: create the row (started at `new`).
        tx.insert(findingDispositions)
          .values({
            id: newId(findingIdSchema),
            projectId: op.projectId,
            fingerprint: op.fingerprint,
            status: op.status,
            notes: '',
          })
          .run();
        return { ...op, previousStatus: 'new' };
      }
      case 'SetFindingNote': {
        const existing = findDisposition(tx, op.projectId, op.fingerprint);
        if (existing) {
          const previousNote = existing.notes;
          tx.update(findingDispositions)
            .set({ notes: op.note })
            .where(eq(findingDispositions.id, existing.id))
            .run();
          return { ...op, previousNote };
        }
        tx.insert(findingDispositions)
          .values({
            id: newId(findingIdSchema),
            projectId: op.projectId,
            fingerprint: op.fingerprint,
            status: 'new',
            notes: op.note,
          })
          .run();
        return { ...op, previousNote: '' };
      }
      case 'SetChangeSetReviewStatus': {
        // P4-M6: the sign-off transition. No one-way transition graph is
        // enforced here — undo/redo must re-apply reverse transitions; the
        // real invariant is the apply gate (only `approved` ChangeSets apply).
        // `reviewedAt` always stamps the latest transition (an undo IS a new
        // review event); the full history lives in the operation log.
        const row = tx
          .select()
          .from(changeSets)
          .where(and(eq(changeSets.id, op.changeSetId), eq(changeSets.projectId, op.projectId)))
          .get();
        if (!row) {
          throw new OperationError('NOT_FOUND', `ChangeSet ${op.changeSetId} not found`);
        }
        const previousStatus = row.reviewStatus ?? 'draft';
        const previousNote = row.reviewNote;
        tx.update(changeSets)
          .set({
            reviewStatus: op.status,
            reviewNote: op.note,
            reviewedAt: new Date().toISOString(),
          })
          .where(eq(changeSets.id, op.changeSetId))
          .run();
        return { ...op, previousStatus, previousNote };
      }
    }
  }

  /** The disposition row for a fingerprint in a project, if the operator has touched it. */
  function findDisposition(tx: Tx, projectId: string, fingerprint: string) {
    return tx
      .select()
      .from(findingDispositions)
      .where(
        and(
          eq(findingDispositions.projectId, projectId),
          eq(findingDispositions.fingerprint, fingerprint),
        ),
      )
      .get();
  }

  function entityPayloadFromRow(
    entityType: EntityPayload['entityType'],
    row: unknown,
  ): EntityPayload {
    switch (entityType) {
      case 'site':
        return { entityType, entity: siteSchema.parse(row) };
      case 'zone':
        return { entityType, entity: zoneSchema.parse(row) };
      case 'device':
        return { entityType, entity: deviceSchema.parse(row) };
      case 'interface':
        return { entityType, entity: interfaceSchema.parse(row) };
      case 'address':
        return { entityType, entity: addressSchema.parse(row) };
      case 'network':
        return { entityType, entity: networkSchema.parse(row) };
      case 'service':
        return { entityType, entity: serviceSchema.parse(row) };
      case 'flow':
        return { entityType, entity: flowSchema.parse(row) };
      case 'hostArtifact':
        return { entityType, entity: hostArtifactSchema.parse(row) };
      case 'report':
        return { entityType, entity: reportRecordSchema.parse(row) };
      case 'importProfile':
        return { entityType, entity: importProfileSchema.parse(row) };
      case 'secretMatch':
        return { entityType, entity: secretMatchSchema.parse(row) };
      case 'identity':
        return { entityType, entity: identitySchema.parse(row) };
      case 'roleAssignment':
        return { entityType, entity: roleAssignmentSchema.parse(row) };
      case 'baseline':
        return { entityType, entity: baselineSchema.parse(row) };
    }
  }

  function appendLog(
    tx: Tx,
    op: Operation,
    role: 'do' | 'undo' | 'redo',
    changeSetId: string | null,
    targetUnitId: string | null,
  ): void {
    tx.insert(operationLog)
      .values({
        id: op.id,
        projectId: op.projectId,
        changeSetId,
        kind: op.kind,
        payload: op,
        role,
        targetUnitId,
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  // ---------- undo/redo stacks derived from the append-only log ----------

  function deriveStacks(projectId: string): { undoStack: Unit[]; redoStack: Unit[] } {
    const undoStack: Unit[] = [];
    let redoStack: Unit[] = [];
    for (const entry of getLog(projectId)) {
      if (entry.role === 'do') {
        const top = undoStack[undoStack.length - 1];
        if (entry.changeSetId && top && top.changeSetId === entry.changeSetId) {
          top.ops.push(entry.payload);
        } else {
          undoStack.push({
            unitId: entry.changeSetId ?? entry.id,
            changeSetId: entry.changeSetId,
            ops: [entry.payload],
          });
          redoStack = [];
        }
      } else if (entry.role === 'undo') {
        const top = undoStack[undoStack.length - 1];
        if (top && top.unitId === entry.targetUnitId) {
          undoStack.pop();
          redoStack.push(top);
        }
      } else {
        const top = redoStack[redoStack.length - 1];
        if (top && top.unitId === entry.targetUnitId) {
          redoStack.pop();
          undoStack.push(top);
        }
      }
    }
    return { undoStack, redoStack };
  }

  function availability(projectId: string): UndoRedoAvailability {
    const { undoStack, redoStack } = deriveStacks(projectId);
    return { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
  }

  // ---------- public mutation surface ----------

  function applyOperation(op: Operation): ApplyResult {
    const parsed = parseOperation(op);
    requireProject(parsed.projectId);
    const applied = db.transaction((tx) => {
      const enriched = applyOne(tx, parsed);
      appendLog(tx, enriched, 'do', null, null);
      return enriched;
    });
    return { appliedOperations: [applied], availability: availability(parsed.projectId) };
  }

  /**
   * Apply a ChangeSet, optionally with extra writes in the same transaction —
   * the import commit path (ADR-0021) uses `also` to write provenance rows
   * and the ImportJob status atomically with the entity mutations.
   */
  function applyChangeSetWith(changeSet: ChangeSet, also?: (tx: Tx) => void): ApplyResult {
    const result = changeSetSchema.safeParse(changeSet);
    if (!result.success) {
      throw new OperationError('INVALID', `Invalid ChangeSet: ${result.error.message}`);
    }
    const parsed = result.data;
    requireProject(parsed.projectId);
    if (parsed.operations.some((o) => o.projectId !== parsed.projectId)) {
      throw new OperationError('INVALID', 'ChangeSet contains operations for another project');
    }
    const applied = db.transaction((tx) => {
      const registered = tx.select().from(changeSets).where(eq(changeSets.id, parsed.id)).get();
      if (registered) {
        // The sign-off gate (P4-M6, ADR-0026): a registered proposal ChangeSet
        // applies to AS-IS only once the operator has approved it.
        if (registered.projectId !== parsed.projectId) {
          throw new OperationError('INVALID', 'ChangeSet is registered under another project');
        }
        if (registered.reviewStatus !== 'approved') {
          throw new OperationError(
            'CONFLICT',
            `ChangeSet ${parsed.id} is ${registered.reviewStatus ?? 'already applied'}, not approved — sign-off is required before applying a proposal`,
          );
        }
        const alreadyApplied = tx
          .select({ id: operationLog.id })
          .from(operationLog)
          .where(and(eq(operationLog.changeSetId, parsed.id), eq(operationLog.role, 'do')))
          .get();
        if (alreadyApplied) {
          throw new OperationError('CONFLICT', `ChangeSet ${parsed.id} was already applied`);
        }
      } else {
        // unregistered = applied directly without entering review (imports,
        // ad-hoc batches); reviewStatus stays null
        tx.insert(changeSets)
          .values({
            id: parsed.id,
            projectId: parsed.projectId,
            label: parsed.label,
            createdAt: new Date().toISOString(),
          })
          .run();
      }
      const ops = parsed.operations.map((op) => {
        const enriched = applyOne(tx, op);
        appendLog(tx, enriched, 'do', parsed.id, null);
        return enriched;
      });
      also?.(tx);
      return ops;
    });
    return { appliedOperations: applied, availability: availability(parsed.projectId) };
  }

  function applyChangeSet(changeSet: ChangeSet): ApplyResult {
    return applyChangeSetWith(changeSet);
  }

  /** Run arbitrary writes in one transaction (import-spine bookkeeping only). */
  function withTransaction<T>(fn: (tx: Tx) => T): T {
    return db.transaction((tx) => fn(tx));
  }

  /**
   * Register a proposal ChangeSet shell (P4-M6): a named intent to change
   * AS-IS, starting in `draft` with no operations applied. Like project
   * creation this is workspace bookkeeping, not a model mutation — the model
   * changes only when the approved proposal's operations apply. Status
   * transitions from here on are logged Operations (I3).
   */
  function registerChangeSet(projectId: string, label: string): ChangeSetRecord {
    requireProject(projectId);
    const record = changeSetRecordSchema.parse({
      id: newId(changeSetIdSchema),
      projectId,
      label,
      createdAt: new Date().toISOString(),
      reviewStatus: 'draft',
      reviewedAt: null,
      reviewNote: '',
    });
    db.insert(changeSets).values(record).run();
    return record;
  }

  function listChangeSets(projectId: string): ChangeSetRecord[] {
    requireProject(projectId);
    return db
      .select()
      .from(changeSets)
      .where(eq(changeSets.projectId, projectId))
      .orderBy(asc(changeSets.id))
      .all()
      .map((row) => changeSetRecordSchema.parse(row));
  }

  function undo(projectId: string): ApplyResult | null {
    requireProject(projectId);
    const { undoStack } = deriveStacks(projectId);
    const unit = undoStack[undoStack.length - 1];
    if (!unit) return null;
    const applied = db.transaction((tx) =>
      unit.ops
        .slice()
        .reverse()
        .map((op) => {
          const inverse = invertOperation(op, newId(operationIdSchema));
          const enriched = applyOne(tx, inverse);
          appendLog(tx, enriched, 'undo', null, unit.unitId);
          return enriched;
        }),
    );
    return { appliedOperations: applied, availability: availability(projectId) };
  }

  function redo(projectId: string): ApplyResult | null {
    requireProject(projectId);
    const { redoStack } = deriveStacks(projectId);
    const unit = redoStack[redoStack.length - 1];
    if (!unit) return null;
    const applied = db.transaction((tx) =>
      unit.ops.map((op) => {
        const reapplied = { ...op, id: newId(operationIdSchema) };
        const enriched = applyOne(tx, reapplied);
        appendLog(tx, enriched, 'redo', null, unit.unitId);
        return enriched;
      }),
    );
    return { appliedOperations: applied, availability: availability(projectId) };
  }

  function parseOperation(op: unknown): Operation {
    const result = operationSchema.safeParse(op);
    if (!result.success) {
      throw new OperationError('INVALID', `Invalid Operation: ${result.error.message}`);
    }
    return result.data;
  }

  /**
   * Restore a full project (ADR-0016 bundle import): every entity keeps its
   * UUIDv7 and relationships. Like createProject this is workspace bootstrap,
   * not a model mutation — the restored project starts with an empty
   * operation log, exactly as the original did after its own creation.
   */
  function importState(state: ProjectState): Project {
    const parsed = projectStateSchema.parse(state);
    if (getProject(parsed.project.id)) {
      throw new OperationError('CONFLICT', `Project ${parsed.project.id} already exists`);
    }
    db.transaction((tx) => {
      tx.insert(projects).values(parsed.project).run();
      for (const site of parsed.sites) tx.insert(sites).values(site).run();
      for (const zone of parsed.zones) tx.insert(zones).values(zone).run();
      for (const network of parsed.networks) tx.insert(networks).values(network).run();
      for (const device of parsed.devices) tx.insert(devices).values(device).run();
      for (const iface of parsed.interfaces) tx.insert(interfaces).values(iface).run();
      for (const address of parsed.addresses) tx.insert(addresses).values(address).run();
      for (const service of parsed.services) tx.insert(services).values(service).run();
      for (const link of parsed.links) tx.insert(links).values(link).run();
      for (const rule of parsed.policyRules) tx.insert(policyRules).values(rule).run();
      for (const flow of parsed.flows) tx.insert(flows).values(flow).run();
      for (const artifact of parsed.hostArtifacts) tx.insert(hostArtifacts).values(artifact).run();
      for (const report of parsed.reports) tx.insert(reports).values(report).run();
      for (const profile of parsed.importProfiles)
        tx.insert(importProfilesTable).values(profile).run();
      for (const secret of parsed.secretMatches) tx.insert(secretMatches).values(secret).run();
      for (const identity of parsed.identities) tx.insert(identities).values(identity).run();
      for (const assignment of parsed.roleAssignments)
        tx.insert(roleAssignments).values(assignment).run();
      for (const disposition of parsed.findingDispositions)
        tx.insert(findingDispositions).values(disposition).run();
      for (const baseline of parsed.baselines) tx.insert(baselines).values(baseline).run();
    });
    return parsed.project;
  }

  // ---------- reads: search & relationships ----------

  function search(projectId: string, query: string): SearchResult[] {
    const state = getState(projectId);
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const hit = (...values: (string | number | null)[]) =>
      values.some((v) => v != null && String(v).toLowerCase().includes(needle));

    const results: SearchResult[] = [];
    for (const site of state.sites) {
      if (hit(site.name, site.description)) results.push({ entityType: 'site', entity: site });
    }
    for (const zone of state.zones) {
      if (hit(zone.name, zone.description)) results.push({ entityType: 'zone', entity: zone });
    }
    for (const device of state.devices) {
      if (
        hit(
          device.name,
          device.vendor,
          device.model,
          device.customTypeLabel,
          device.notes,
          ...device.tags,
        )
      ) {
        results.push({ entityType: 'device', entity: device });
      }
    }
    for (const iface of state.interfaces) {
      if (hit(iface.name)) results.push({ entityType: 'interface', entity: iface });
    }
    for (const address of state.addresses) {
      if (hit(address.value)) results.push({ entityType: 'address', entity: address });
    }
    for (const network of state.networks) {
      if (hit(network.name, network.cidr, network.vlanId, network.description)) {
        results.push({ entityType: 'network', entity: network });
      }
    }
    for (const service of state.services) {
      if (hit(service.name, service.process, service.portStart, service.portEnd)) {
        results.push({ entityType: 'service', entity: service });
      }
    }
    for (const link of state.links) {
      if (hit(link.label, link.notes)) results.push({ entityType: 'link', entity: link });
    }
    for (const rule of state.policyRules) {
      if (hit(rule.name, rule.justification, rule.owner, rule.notes)) {
        results.push({ entityType: 'policyRule', entity: rule });
      }
    }
    for (const identity of state.identities) {
      if (hit(identity.name, identity.domain, identity.notes)) {
        results.push({ entityType: 'identity', entity: identity });
      }
    }
    return results;
  }

  function getEntityWithRelationships(
    projectId: string,
    entityType: SettableEntityType,
    entityId: string,
  ): { entity: unknown; relationships: Record<string, unknown> } {
    const state = getState(projectId);
    const linksTouching = (interfaceIds: Set<string>) =>
      state.links.filter((l) => interfaceIds.has(l.source.id) || interfaceIds.has(l.target.id));
    const rulesTouching = (kinds: Endpoint['kind'][], id: string) =>
      state.policyRules.filter((r) =>
        [r.source, r.destination].some((e) => kinds.includes(e.kind) && e.id === id),
      );
    const interfaceWithDetail = (iface: Interface) => ({
      ...iface,
      addresses: state.addresses.filter((a) => a.interfaceId === iface.id),
      network: state.networks.find((n) => n.id === iface.networkId) ?? null,
    });

    switch (entityType) {
      case 'project':
        return { entity: state.project, relationships: { sites: state.sites } };
      case 'site': {
        const entity = state.sites.find((s) => s.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `site ${entityId} not found`);
        return {
          entity,
          relationships: { zones: state.zones.filter((z) => z.siteId === entityId) },
        };
      }
      case 'zone': {
        const entity = state.zones.find((z) => z.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `zone ${entityId} not found`);
        return {
          entity,
          relationships: {
            site: state.sites.find((s) => s.id === entity.siteId) ?? null,
            devices: state.devices.filter((d) => d.zoneId === entityId),
            policyRules: rulesTouching(['zone'], entityId),
          },
        };
      }
      case 'device': {
        const entity = state.devices.find((d) => d.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `device ${entityId} not found`);
        const ifaces = state.interfaces.filter((i) => i.deviceId === entityId);
        return {
          entity,
          relationships: {
            zone: state.zones.find((z) => z.id === entity.zoneId) ?? null,
            interfaces: ifaces.map(interfaceWithDetail),
            services: state.services.filter((s) => s.deviceId === entityId),
            links: linksTouching(new Set(ifaces.map((i) => i.id))),
            policyRules: rulesTouching(['device'], entityId),
          },
        };
      }
      case 'interface': {
        const entity = state.interfaces.find((i) => i.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `interface ${entityId} not found`);
        return {
          entity,
          relationships: {
            device: state.devices.find((d) => d.id === entity.deviceId) ?? null,
            network: state.networks.find((n) => n.id === entity.networkId) ?? null,
            addresses: state.addresses.filter((a) => a.interfaceId === entityId),
            links: linksTouching(new Set([entityId])),
            policyRules: rulesTouching(['interface'], entityId),
          },
        };
      }
      case 'address': {
        const entity = state.addresses.find((a) => a.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `address ${entityId} not found`);
        return {
          entity,
          relationships: {
            interface: state.interfaces.find((i) => i.id === entity.interfaceId) ?? null,
          },
        };
      }
      case 'network': {
        const entity = state.networks.find((n) => n.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `network ${entityId} not found`);
        const members = state.interfaces.filter((i) => i.networkId === entityId);
        return {
          entity,
          relationships: {
            members: members.map((iface) => ({
              ...iface,
              device: state.devices.find((d) => d.id === iface.deviceId) ?? null,
            })),
            policyRules: rulesTouching(['network', 'subnet'], entityId),
          },
        };
      }
      case 'link': {
        const entity = state.links.find((l) => l.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `link ${entityId} not found`);
        const resolve = (id: string) => {
          const iface = state.interfaces.find((i) => i.id === id) ?? null;
          return iface ? interfaceWithDetail(iface) : null;
        };
        return {
          entity,
          relationships: { source: resolve(entity.source.id), target: resolve(entity.target.id) },
        };
      }
      case 'service': {
        const entity = state.services.find((s) => s.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `service ${entityId} not found`);
        return {
          entity,
          relationships: {
            device: state.devices.find((d) => d.id === entity.deviceId) ?? null,
            policyRules: state.policyRules.filter((r) => r.serviceId === entityId),
          },
        };
      }
      case 'flow': {
        const entity = state.flows.find((f) => f.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `flow ${entityId} not found`);
        const endpoints = endpointResolver(state);
        // externals keep their wire shape; entity references resolve or null
        const resolveFlowEndpoint = (e: Flow['source']): unknown =>
          e.kind === 'external' ? { external: e.value } : endpoints.entity(e);
        return {
          entity,
          relationships: {
            service: state.services.find((s) => s.id === entity.serviceId) ?? null,
            source: resolveFlowEndpoint(entity.source),
            destination: resolveFlowEndpoint(entity.destination),
          },
        };
      }
      case 'hostArtifact': {
        const entity = state.hostArtifacts.find((a) => a.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `hostArtifact ${entityId} not found`);
        return {
          entity,
          relationships: {
            device: state.devices.find((d) => d.id === entity.deviceId) ?? null,
          },
        };
      }
      case 'report': {
        const entity = state.reports.find((r) => r.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `report ${entityId} not found`);
        return { entity, relationships: {} };
      }
      case 'importProfile': {
        const entity = state.importProfiles.find((r) => r.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `importProfile ${entityId} not found`);
        return { entity, relationships: {} };
      }
      case 'secretMatch': {
        const entity = state.secretMatches.find((r) => r.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `secretMatch ${entityId} not found`);
        return { entity, relationships: {} };
      }
      case 'identity': {
        const entity = state.identities.find((i) => i.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `identity ${entityId} not found`);
        const assignments = state.roleAssignments.filter((r) => r.identityId === entityId);
        return {
          entity,
          relationships: {
            device: state.devices.find((d) => d.id === entity.deviceId) ?? null,
            roleAssignments: assignments.map((assignment) => ({
              ...assignment,
              device: state.devices.find((d) => d.id === assignment.deviceId) ?? null,
            })),
          },
        };
      }
      case 'roleAssignment': {
        const entity = state.roleAssignments.find((r) => r.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `roleAssignment ${entityId} not found`);
        return {
          entity,
          relationships: {
            identity: state.identities.find((i) => i.id === entity.identityId) ?? null,
            device: state.devices.find((d) => d.id === entity.deviceId) ?? null,
          },
        };
      }
      case 'baseline': {
        const entity = state.baselines.find((b) => b.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `baseline ${entityId} not found`);
        const resolveScope = (): unknown => {
          switch (entity.scope.kind) {
            case 'zone':
              return state.zones.find((z) => z.id === entity.scope.id) ?? null;
            case 'network':
              return state.networks.find((n) => n.id === entity.scope.id) ?? null;
            case 'device':
              return state.devices.find((d) => d.id === entity.scope.id) ?? null;
          }
        };
        return { entity, relationships: { scope: resolveScope() } };
      }
      case 'policyRule': {
        const entity = state.policyRules.find((r) => r.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `policyRule ${entityId} not found`);
        const endpoints = endpointResolver(state);
        return {
          entity,
          relationships: {
            service: state.services.find((s) => s.id === entity.serviceId) ?? null,
            source: endpoints.entity(entity.source),
            destination: endpoints.entity(entity.destination),
          },
        };
      }
    }
  }

  return {
    createProject,
    listProjects,
    getProject,
    deleteProject,
    importState,
    getState,
    queryFlows,
    getLog,
    getWatermark,
    applyOperation,
    applyChangeSet,
    applyChangeSetWith,
    registerChangeSet,
    listChangeSets,
    withTransaction,
    undo,
    redo,
    availability,
    search,
    getEntityWithRelationships,
  };
}

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

/** Canonicalize a DB value for storage inside an Operation payload. */
function toJsonValue(value: unknown): JsonValue {
  const parsed: unknown = JSON.parse(JSON.stringify(value ?? null));
  return jsonValueOf(parsed);
}

function jsonValueOf(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValueOf);
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonValueOf(v);
    return out;
  }
  throw new OperationError('INVALID', 'Field value is not JSON-serializable');
}
