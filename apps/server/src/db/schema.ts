import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { LifecycleState, LinkEndpoint, PolicyEndpoint, Position } from '@netplan/domain';

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
};
export type EntityTableKey = keyof typeof entityTables;
