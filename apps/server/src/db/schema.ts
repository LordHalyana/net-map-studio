import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type {
  ConfidenceContributor,
  EvidenceContentClass,
  EvidenceRetention,
  FieldValue,
  FlowEndpoint,
  IdentityKind,
  IdentityScope,
  ImportJobStatus,
  LifecycleState,
  LinkEndpoint,
  ObservationClaim,
  PolicyEndpoint,
  Position,
  ProvenanceSourceType,
  ProvenanceStatus,
  RolePrivilege,
  SettableEntityType,
} from '@netplan/domain';

/**
 * Persistence mapping for the domain schemas (ADR-0007, ADR-0017). The Zod
 * schemas in @netplan/domain are the source of truth; the alignment test
 * proves these tables match them key-for-key. Kept dialect-portable —
 * no SQLite-only column tricks — so the Postgres move is a swap.
 *
 * Column keys deliberately mirror domain field names 1:1.
 */

const lifecycleState = () => text('lifecycle_state').$type<LifecycleState>().notNull();
const tags = () => text('tags', { mode: 'json' }).$type<string[]>().notNull();
const position = () => text('position', { mode: 'json' }).$type<Position>().notNull();

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  createdAt: text('created_at').notNull(),
  lifecycleState: lifecycleState(),
});

export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  description: text('description').notNull(),
  lifecycleState: lifecycleState(),
  tags: tags(),
  notes: text('notes').notNull(),
  position: position(),
});

export const zones = sqliteTable('zones', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  siteId: text('site_id')
    .notNull()
    .references(() => sites.id),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  lifecycleState: lifecycleState(),
  tags: tags(),
  notes: text('notes').notNull(),
  position: position(),
});

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  zoneId: text('zone_id').references(() => zones.id),
  name: text('name').notNull(),
  deviceType: text('device_type').notNull(),
  customTypeLabel: text('custom_type_label').notNull(),
  customIconKey: text('custom_icon_key').notNull(),
  vendor: text('vendor').notNull(),
  model: text('model').notNull(),
  os: text('os').notNull(),
  serialNumber: text('serial_number').notNull(),
  assetTag: text('asset_tag').notNull(),
  location: text('location').notNull(),
  criticality: text('criticality').notNull(),
  status: text('status').notNull(),
  lifecycleState: lifecycleState(),
  tags: tags(),
  notes: text('notes').notNull(),
  position: position(),
  pinned: integer('pinned', { mode: 'boolean' }).notNull(),
});

export const networks = sqliteTable('networks', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  vlanId: integer('vlan_id'),
  cidr: text('cidr').notNull(),
  description: text('description').notNull(),
  lifecycleState: lifecycleState(),
  tags: tags(),
  layoutHints: text('layout_hints', { mode: 'json' }).$type<Record<string, Position>>().notNull(),
});

export const interfaces = sqliteTable('interfaces', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  deviceId: text('device_id')
    .notNull()
    .references(() => devices.id),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  networkId: text('network_id').references(() => networks.id),
  lifecycleState: lifecycleState(),
  notes: text('notes').notNull(),
});

export const addresses = sqliteTable('addresses', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  interfaceId: text('interface_id')
    .notNull()
    .references(() => interfaces.id),
  kind: text('kind').notNull(),
  value: text('value').notNull(),
  lifecycleState: lifecycleState(),
});

export const links = sqliteTable('links', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  source: text('source', { mode: 'json' }).$type<LinkEndpoint>().notNull(),
  target: text('target', { mode: 'json' }).$type<LinkEndpoint>().notNull(),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  lifecycleState: lifecycleState(),
  notes: text('notes').notNull(),
});

export const services = sqliteTable('services', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  deviceId: text('device_id').references(() => devices.id),
  name: text('name').notNull(),
  protocol: text('protocol').notNull(),
  portStart: integer('port_start'),
  portEnd: integer('port_end'),
  process: text('process').notNull(),
  description: text('description').notNull(),
  lifecycleState: lifecycleState(),
});

export const policyRules = sqliteTable('policy_rules', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  source: text('source', { mode: 'json' }).$type<PolicyEndpoint>().notNull(),
  destination: text('destination', { mode: 'json' }).$type<PolicyEndpoint>().notNull(),
  serviceId: text('service_id').references(() => services.id),
  direction: text('direction').notNull(),
  action: text('action').notNull(),
  logging: integer('logging', { mode: 'boolean' }).notNull(),
  owner: text('owner').notNull(),
  justification: text('justification').notNull(),
  reviewDate: text('review_date'),
  lifecycleState: lifecycleState(),
  notes: text('notes').notNull(),
});

export const flows = sqliteTable('flows', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  source: text('source', { mode: 'json' }).$type<FlowEndpoint>().notNull(),
  destination: text('destination', { mode: 'json' }).$type<FlowEndpoint>().notNull(),
  protocol: text('protocol').notNull(),
  port: integer('port'),
  serviceId: text('service_id').references(() => services.id),
  firstSeen: text('first_seen').notNull(),
  lastSeen: text('last_seen').notNull(),
  observationCount: integer('observation_count').notNull(),
  confidence: real('confidence').notNull(),
  lifecycleState: lifecycleState(),
});

export const identities = sqliteTable('identities', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  scope: text('scope').$type<IdentityScope>().notNull(),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  kind: text('kind').$type<IdentityKind>().notNull(),
  deviceId: text('device_id').references(() => devices.id),
  lifecycleState: lifecycleState(),
  notes: text('notes').notNull(),
});

export const roleAssignments = sqliteTable('role_assignments', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  identityId: text('identity_id')
    .notNull()
    .references(() => identities.id),
  deviceId: text('device_id').references(() => devices.id),
  privilege: text('privilege').$type<RolePrivilege>().notNull(),
  detail: text('detail').notNull(),
  lifecycleState: lifecycleState(),
});

/**
 * Per-field provenance sidecar (ADR-0008), keyed by (entityType, entityId,
 * field) with competing rows side by side. The entity tables keep the plain,
 * indexable current value; this table keeps where it came from.
 */
export const fieldProvenance = sqliteTable('field_provenance', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  entityType: text('entity_type').$type<SettableEntityType>().notNull(),
  entityId: text('entity_id').notNull(),
  field: text('field').notNull(),
  sourceType: text('source_type').$type<ProvenanceSourceType>().notNull(),
  evidenceId: text('evidence_id'),
  importJobId: text('import_job_id'),
  observationId: text('observation_id'),
  confidence: real('confidence').notNull(),
  parserVersion: text('parser_version').notNull(),
  status: text('status').$type<ProvenanceStatus>().notNull(),
  observedValue: text('observed_value', { mode: 'json' }).$type<FieldValue>().notNull(),
  observedAt: text('observed_at').notNull(),
});

/**
 * The import spine (ADR-0019, ADR-0020): ImportJob lifecycle, read-only
 * Evidence records with split-by-class blob retention, and the neutral
 * Observations adapters emit. Blobs live in their own table — the evidence
 * record (and its hash) always survives even when a blob is dropped.
 */
export const importJobs = sqliteTable('import_jobs', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  status: text('status').$type<ImportJobStatus>().notNull(),
  parserName: text('parser_name').notNull(),
  parserVersion: text('parser_version').notNull(),
  schemaVersion: text('schema_version').notNull(),
  changeSetId: text('change_set_id'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  error: text('error'),
});

export const evidence = sqliteTable('evidence', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  importJobId: text('import_job_id')
    .notNull()
    .references(() => importJobs.id),
  filename: text('filename').notNull(),
  sha256: text('sha256').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  contentClass: text('content_class').$type<EvidenceContentClass>().notNull(),
  retention: text('retention').$type<EvidenceRetention>().notNull(),
  chunkRef: text('chunk_ref'),
  parserName: text('parser_name').notNull(),
  parserVersion: text('parser_version').notNull(),
  collectedAt: text('collected_at'),
  importedAt: text('imported_at').notNull(),
});

/** Raw evidence bytes, write-once (ADR-0019). Absent when retention is hashOnly. */
export const evidenceBlobs = sqliteTable('evidence_blobs', {
  evidenceId: text('evidence_id')
    .primaryKey()
    .references(() => evidence.id),
  encoding: text('encoding').$type<'utf8' | 'base64'>().notNull(),
  content: text('content').notNull(),
});

export const observations = sqliteTable('observations', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  importJobId: text('import_job_id')
    .notNull()
    .references(() => importJobs.id),
  evidenceId: text('evidence_id')
    .notNull()
    .references(() => evidence.id),
  contributor: text('contributor').$type<ConfidenceContributor>().notNull(),
  observedAt: text('observed_at'),
  claim: text('claim', { mode: 'json' }).$type<ObservationClaim>().notNull(),
});

/**
 * The operation log (ADR-0010): strictly append-only. `payload` is the full
 * enriched Operation as applied. Undo/redo entries are themselves appended
 * rows (`role`), never edits to prior rows — current undo/redo availability
 * is derived by replaying the log, so the audit trail stays trustworthy.
 */
export const operationLog = sqliteTable('operation_log', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  changeSetId: text('change_set_id'),
  kind: text('kind').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  role: text('role').$type<'do' | 'undo' | 'redo'>().notNull(),
  /** For undo/redo rows: the unit (changeSetId or single opId) being undone/redone. */
  targetUnitId: text('target_unit_id'),
  createdAt: text('created_at').notNull(),
});

export const changeSets = sqliteTable('change_sets', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  label: text('label').notNull(),
  createdAt: text('created_at').notNull(),
});

export const entityTables = {
  project: projects,
  site: sites,
  zone: zones,
  device: devices,
  interface: interfaces,
  address: addresses,
  network: networks,
  link: links,
  service: services,
  policyRule: policyRules,
  flow: flows,
  identity: identities,
  roleAssignment: roleAssignments,
};
export type EntityTableKey = keyof typeof entityTables;
