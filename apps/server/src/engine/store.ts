import { and, asc, eq } from 'drizzle-orm';
import {
  addressSchema,
  changeSetSchema,
  deviceSchema,
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
  serviceSchema,
  siteSchema,
  zoneSchema,
  invertOperation,
  type Address,
  type ChangeSet,
  type Device,
  type Endpoint,
  type EntityPayload,
  type Interface,
  type Link,
  type Network,
  type Operation,
  type PolicyRule,
  type Project,
  type ProjectState,
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
  changeSets,
  devices,
  interfaces,
  links,
  networks,
  operationLog,
  policyRules,
  projects,
  services,
  sites,
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

export interface SearchResult {
  entityType: Exclude<SettableEntityType, 'project'>;
  entity: Site | Zone | Device | Interface | Address | Network | Link | Service | PolicyRule;
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
};

/** Fields that reference another entity, checked on SetField (ADR-0012 note). */
const referenceFields: Partial<
  Record<
    SettableEntityType,
    Record<string, 'site' | 'zone' | 'device' | 'interface' | 'network' | 'service'>
  >
> = {
  zone: { siteId: 'site' },
  device: { zoneId: 'zone' },
  interface: { deviceId: 'device', networkId: 'network' },
  address: { interfaceId: 'interface' },
  service: { deviceId: 'device' },
  policyRule: { serviceId: 'service' },
};

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

  function getState(projectId: string): ProjectState {
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
    };
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
      tx.delete(operationLog).where(eq(operationLog.projectId, projectId)).run();
      tx.delete(changeSets).where(eq(changeSets.projectId, projectId)).run();
      tx.delete(policyRules).where(eq(policyRules.projectId, projectId)).run();
      tx.delete(links).where(eq(links.projectId, projectId)).run();
      tx.delete(services).where(eq(services.projectId, projectId)).run();
      tx.delete(addresses).where(eq(addresses.projectId, projectId)).run();
      tx.delete(interfaces).where(eq(interfaces.projectId, projectId)).run();
      tx.delete(devices).where(eq(devices.projectId, projectId)).run();
      tx.delete(networks).where(eq(networks.projectId, projectId)).run();
      tx.delete(zones).where(eq(zones.projectId, projectId)).run();
      tx.delete(sites).where(eq(sites.projectId, projectId)).run();
      tx.delete(projects).where(eq(projects.id, projectId)).run();
    });
  }

  // ---------- shared checks ----------

  type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

  function exists(
    tx: Tx,
    kind: 'site' | 'zone' | 'device' | 'interface' | 'network' | 'service',
    projectId: string,
    id: string,
  ): boolean {
    switch (kind) {
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

  function requireRef(
    tx: Tx,
    projectId: string,
    kind: 'site' | 'zone' | 'device' | 'interface' | 'network' | 'service',
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

    switch (entityType) {
      case 'site':
        if (tx.select({ id: zones.id }).from(zones).where(eq(zones.siteId, id)).get())
          fail('a Zone');
        return;
      case 'zone':
        if (tx.select({ id: devices.id }).from(devices).where(eq(devices.zoneId, id)).get())
          fail('a Device');
        if (ruleTouches(['zone'])) fail('a PolicyRule');
        return;
      case 'device':
        if (
          tx.select({ id: interfaces.id }).from(interfaces).where(eq(interfaces.deviceId, id)).get()
        )
          fail('an Interface');
        if (tx.select({ id: services.id }).from(services).where(eq(services.deviceId, id)).get())
          fail('a Service');
        if (ruleTouches(['device'])) fail('a PolicyRule');
        return;
      case 'interface':
        if (
          tx.select({ id: addresses.id }).from(addresses).where(eq(addresses.interfaceId, id)).get()
        )
          fail('an Address');
        if (projectLinks().some((l) => l.source.id === id || l.target.id === id)) fail('a Link');
        if (ruleTouches(['interface'])) fail('a PolicyRule');
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
    }
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

  function applyChangeSet(changeSet: ChangeSet): ApplyResult {
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
      tx.insert(changeSets)
        .values({
          id: parsed.id,
          projectId: parsed.projectId,
          label: parsed.label,
          createdAt: new Date().toISOString(),
        })
        .run();
      return parsed.operations.map((op) => {
        const enriched = applyOne(tx, op);
        appendLog(tx, enriched, 'do', parsed.id, null);
        return enriched;
      });
    });
    return { appliedOperations: applied, availability: availability(parsed.projectId) };
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
      case 'policyRule': {
        const entity = state.policyRules.find((r) => r.id === entityId);
        if (!entity) throw new OperationError('NOT_FOUND', `policyRule ${entityId} not found`);
        const resolveEndpoint = (e: Endpoint): unknown => {
          switch (e.kind) {
            case 'interface':
              return state.interfaces.find((i) => i.id === e.id) ?? null;
            case 'device':
              return state.devices.find((d) => d.id === e.id) ?? null;
            case 'zone':
              return state.zones.find((z) => z.id === e.id) ?? null;
            case 'network':
            case 'subnet':
              return state.networks.find((n) => n.id === e.id) ?? null;
          }
        };
        return {
          entity,
          relationships: {
            service: state.services.find((s) => s.id === entity.serviceId) ?? null,
            source: resolveEndpoint(entity.source),
            destination: resolveEndpoint(entity.destination),
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
    getLog,
    applyOperation,
    applyChangeSet,
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
