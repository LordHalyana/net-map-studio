import { z } from 'zod';
import {
  addressIdSchema,
  baselineIdSchema,
  deviceIdSchema,
  flowIdSchema,
  hostArtifactIdSchema,
  importProfileIdSchema,
  reportIdSchema,
  secretMatchIdSchema,
  identityIdSchema,
  interfaceIdSchema,
  linkIdSchema,
  networkIdSchema,
  policyRuleIdSchema,
  projectIdSchema,
  roleAssignmentIdSchema,
  serviceIdSchema,
  siteIdSchema,
  zoneIdSchema,
} from './ids.js';
import { lifecycleStateSchema } from './lifecycle.js';
import { flowEndpointSchema, linkEndpointSchema, policyEndpointSchema } from './endpoints.js';
import { confidenceSchema } from './confidence.js';

const positionSchema = z.object({ x: z.number(), y: z.number() });
export type Position = z.infer<typeof positionSchema>;

/** Operator-set container dimensions; null = the renderer's default size. */
const sizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() });
export type Size = z.infer<typeof sizeSchema>;

/**
 * Per-(network, view) layout hints (ADR-0013): a network-node on the canvas is
 * a projection of Membership, so its position is a hint keyed by view id, not
 * a real topological node.
 */
const layoutHintsSchema = z.record(z.string(), positionSchema).default({});

const tagsSchema = z.array(z.string()).default([]);

export const projectSchema = z.object({
  id: projectIdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  createdAt: z.iso.datetime(),
  lifecycleState: lifecycleStateSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const siteSchema = z.object({
  id: siteIdSchema,
  projectId: projectIdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  lifecycleState: lifecycleStateSchema,
  tags: tagsSchema,
  notes: z.string().default(''),
  position: positionSchema.default({ x: 0, y: 0 }),
  size: sizeSchema.nullable().default(null),
});
export type Site = z.infer<typeof siteSchema>;

export const zoneKindSchema = z.enum([
  'floor',
  'room',
  'rack',
  'segment',
  'trustBoundary',
  'other',
]);

export const zoneSchema = z.object({
  id: zoneIdSchema,
  projectId: projectIdSchema,
  /** Containment (ADR-0013): a Zone belongs to exactly one Site. */
  siteId: siteIdSchema,
  name: z.string().min(1),
  kind: zoneKindSchema.default('other'),
  description: z.string().default(''),
  lifecycleState: lifecycleStateSchema,
  tags: tagsSchema,
  notes: z.string().default(''),
  position: positionSchema.default({ x: 0, y: 0 }),
  size: sizeSchema.nullable().default(null),
});
export type Zone = z.infer<typeof zoneSchema>;

export const deviceTypeSchema = z.enum([
  'router',
  'firewall',
  'switch',
  'accessPoint',
  'vpnGateway',
  'server',
  'nas',
  'dnsServer',
  'dhcpServer',
  'workstation',
  'laptop',
  'mobileDevice',
  'posClient',
  'paymentTerminal',
  'printer',
  'camera',
  'voipDevice',
  'iotDevice',
  'custom',
]);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

export const criticalitySchema = z.enum(['unspecified', 'low', 'medium', 'high', 'critical']);

export const deviceSchema = z.object({
  id: deviceIdSchema,
  projectId: projectIdSchema,
  /**
   * Containment (ADR-0013): at most one physical parent. Null while the
   * Device has not been placed in a Zone yet.
   */
  zoneId: zoneIdSchema.nullable().default(null),
  name: z.string().min(1),
  deviceType: deviceTypeSchema,
  /** Human label for `deviceType: 'custom'`; custom icons still require a structured type. */
  customTypeLabel: z.string().default(''),
  customIconKey: z.string().default(''),
  vendor: z.string().default(''),
  model: z.string().default(''),
  /** Operating system, typically imported (device-state report, Nmap OS guess). */
  os: z.string().default(''),
  serialNumber: z.string().default(''),
  assetTag: z.string().default(''),
  location: z.string().default(''),
  criticality: criticalitySchema.default('unspecified'),
  status: z.enum(['unknown', 'active', 'inactive']).default('unknown'),
  lifecycleState: lifecycleStateSchema,
  tags: tagsSchema,
  notes: z.string().default(''),
  position: positionSchema.default({ x: 0, y: 0 }),
  /** Manual pin (design §3.2C): auto-arrange must not move operator-positioned nodes. */
  pinned: z.boolean().default(false),
});
export type Device = z.infer<typeof deviceSchema>;

export const interfaceKindSchema = z.enum(['ethernet', 'wifi', 'virtual', 'loopback', 'other']);

export const interfaceSchema = z.object({
  id: interfaceIdSchema,
  projectId: projectIdSchema,
  deviceId: deviceIdSchema,
  name: z.string().min(1),
  kind: interfaceKindSchema.default('ethernet'),
  /** Membership (ADR-0013): logical belonging to a Network, never containment. */
  networkId: networkIdSchema.nullable().default(null),
  lifecycleState: lifecycleStateSchema,
  notes: z.string().default(''),
});
export type Interface = z.infer<typeof interfaceSchema>;

export const addressKindSchema = z.enum(['mac', 'ipv4', 'ipv6', 'hostname', 'alias']);
export type AddressKind = z.infer<typeof addressKindSchema>;

export const addressSchema = z.object({
  id: addressIdSchema,
  projectId: projectIdSchema,
  interfaceId: interfaceIdSchema,
  kind: addressKindSchema,
  value: z.string().min(1),
  lifecycleState: lifecycleStateSchema,
});
export type Address = z.infer<typeof addressSchema>;

export const networkKindSchema = z.enum(['subnet', 'vlan', 'ssid', 'routingDomain', 'addressPool']);

export const networkSchema = z.object({
  id: networkIdSchema,
  projectId: projectIdSchema,
  name: z.string().min(1),
  kind: networkKindSchema,
  vlanId: z.number().int().min(1).max(4094).nullable().default(null),
  cidr: z.string().default(''),
  description: z.string().default(''),
  /** Operator-pinned canvas tint (M6, #63); null = hash-stable palette. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  lifecycleState: lifecycleStateSchema,
  tags: tagsSchema,
  layoutHints: layoutHintsSchema,
});
export type Network = z.infer<typeof networkSchema>;

export const linkKindSchema = z.enum(['cable', 'wireless', 'layer2', 'layer3', 'tunnel']);

/**
 * A structural relationship between two Interfaces (ADR-0011). Endpoints are
 * always Interfaces (ADR-0012).
 */
export const linkSchema = z.object({
  id: linkIdSchema,
  projectId: projectIdSchema,
  source: linkEndpointSchema,
  target: linkEndpointSchema,
  kind: linkKindSchema.default('cable'),
  label: z.string().default(''),
  lifecycleState: lifecycleStateSchema,
  notes: z.string().default(''),
});
export type Link = z.infer<typeof linkSchema>;

export const protocolSchema = z.enum(['tcp', 'udp', 'icmp', 'any', 'other']);
export type Protocol = z.infer<typeof protocolSchema>;

/**
 * A protocol/port/process capability. Attached to a Device when it models a
 * listening service; standalone (deviceId null) when it is a reusable
 * "what traffic" object referenced by PolicyRules.
 */
export const serviceSchema = z.object({
  id: serviceIdSchema,
  projectId: projectIdSchema,
  deviceId: deviceIdSchema.nullable().default(null),
  name: z.string().min(1),
  protocol: protocolSchema,
  portStart: z.number().int().min(0).max(65535).nullable().default(null),
  portEnd: z.number().int().min(0).max(65535).nullable().default(null),
  process: z.string().default(''),
  description: z.string().default(''),
  lifecycleState: lifecycleStateSchema,
});
export type Service = z.infer<typeof serviceSchema>;

/**
 * ADR-0022: a modelled Identity is local to one host or a domain principal
 * observed on hosts. The discriminator exists from day one so the P4
 * directory adapter is additive.
 */
export const identityScopeSchema = z.enum(['local', 'domain']);
export type IdentityScope = z.infer<typeof identityScopeSchema>;

export const identityKindSchema = z.enum(['user', 'group', 'serviceAccount']);
export type IdentityKind = z.infer<typeof identityKindSchema>;

/** The privilege half of a RoleAssignment (design §3.9). */
export const rolePrivilegeSchema = z.enum([
  'localAdministrator',
  'sudoer',
  'remoteDesktopUser',
  'serviceLogon',
  'groupMember',
  'other',
]);
export type RolePrivilege = z.infer<typeof rolePrivilegeSchema>;

/**
 * An observed communication (ADR-0011), aggregated per (source, destination,
 * service) with count/first-seen/last-seen (ADR-0020). Unlike other entities
 * it carries its Confidence directly: a Flow is born from evidence and has no
 * meaningful per-field provenance split.
 */
export const flowSchema = z.object({
  id: flowIdSchema,
  projectId: projectIdSchema,
  source: flowEndpointSchema,
  destination: flowEndpointSchema,
  protocol: protocolSchema,
  /** Destination port — the service half of the aggregation key. */
  port: z.number().int().min(0).max(65535).nullable().default(null),
  /** The destination's matching Service entity, when one is known. */
  serviceId: serviceIdSchema.nullable().default(null),
  firstSeen: z.iso.datetime(),
  lastSeen: z.iso.datetime(),
  observationCount: z.number().int().min(1),
  confidence: confidenceSchema,
  lifecycleState: lifecycleStateSchema,
});
export type Flow = z.infer<typeof flowSchema>;

/**
 * Host security artifact (improvements M7, #64): one evidence-derived
 * detection input on a Device — a running process, persistence entry,
 * installed application or file-inventory record. The Flow precedent
 * applied to §3.8's inputs: a typed per-device collection with direct
 * confidence, written only through the import pipeline, never hand-edited.
 * Analysis input, not topology — it never renders on the canvas.
 */
export const hostArtifactKindSchema = z.enum(['process', 'persistence', 'software', 'file']);
export type HostArtifactKind = z.infer<typeof hostArtifactKindSchema>;

/** How a persistence artifact launches (mirrors findings/inputs.ts kinds). */
export const hostPersistenceKindSchema = z.enum(['startup', 'scheduledTask', 'service', 'other']);

export const hostArtifactSchema = z.object({
  id: hostArtifactIdSchema,
  projectId: projectIdSchema,
  deviceId: deviceIdSchema,
  kind: hostArtifactKindSchema,
  /** Process/entry/application name, or the file path for `kind: 'file'`. */
  name: z.string().min(1),
  /** On-disk path (executable, entry binary, file), when reported. */
  path: z.string().nullable().default(null),
  /** The command a persistence entry launches. */
  command: z.string().default(''),
  /** Set only for `kind: 'persistence'`. */
  persistenceKind: hostPersistenceKindSchema.nullable().default(null),
  /** Set only for `kind: 'file'`, when the collector hashed it. */
  sha256: z.string().nullable().default(null),
  publisher: z.string().default(''),
  version: z.string().default(''),
  /** True when the collector tagged software as remote-access/remote-admin. */
  remoteAccess: z.boolean().default(false),
  confidence: confidenceSchema,
  lifecycleState: lifecycleStateSchema,
});
export type HostArtifact = z.infer<typeof hostArtifactSchema>;

/**
 * A detected secret (design §3.13; improvements M13, #70): a credential the
 * masking pass found in ingested evidence. Stored masked-by-default — the raw
 * value never persists; only its mask, kind and provenance do. Revealing the
 * original is a separate, audited action against the source evidence.
 */
export const secretMatchSchema = z.object({
  id: secretMatchIdSchema,
  projectId: projectIdSchema,
  kind: z.enum([
    'privateKey',
    'passwordAssignment',
    'connectionString',
    'highEntropyToken',
    'custom',
  ]),
  label: z.string(),
  /** The masked stand-in shown everywhere by default. */
  masked: z.string(),
  /**
   * Evidence this was found in, for the audited reveal. A bare uuid, not the
   * branded EvidenceId — that brand lives in imports.ts, which imports this
   * module, so referencing it here would be a cycle.
   */
  evidenceId: z.uuidv7(),
  /** Character offset in the evidence text — where reveal re-reads the original. */
  offset: z.number().int().min(0),
  /** Length of the original value, so reveal can slice it back out. */
  length: z.number().int().min(1),
  /** Flipped only by an audited reveal; default false keeps it masked. */
  revealed: z.boolean().default(false),
});
export type SecretMatch = z.infer<typeof secretMatchSchema>;

/**
 * Import profile (design §3.6; improvements M12, #69): an operator-defined
 * line-format template for text evidence the tool does not natively parse
 * (Netcat logs and kin). The regex's named capture groups ARE the field map:
 * `host` (required), `port`, `status`, `banner`. Model config, edited through
 * Operations like every persisted object.
 */
export const importProfileSchema = z.object({
  id: importProfileIdSchema,
  projectId: projectIdSchema,
  name: z.string().min(1),
  /** The adapter this profile drives. */
  adapter: z.string().default('netcat-text'),
  /** Per-line regex with named groups host/port/status/banner. */
  pattern: z
    .string()
    .min(1)
    .refine(
      (value) => {
        try {
          new RegExp(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'pattern must be a valid regular expression' },
    ),
  description: z.string().default(''),
});
export type ImportProfile = z.infer<typeof importProfileSchema>;

/**
 * Report record (design §3.4; improvements M11, #68): the minimal persisted
 * audit trail of a generated deliverable — what was produced, when, under
 * which redaction profile, and the output's hash. Written through the
 * Operation log on every export/report, so client deliverables are
 * reconstructable and auditable (§3.13's audit hook, M13).
 */
export const reportTypeSchema = z.enum([
  'bundle',
  'designReport',
  'findingsReport',
  'changeReport',
  'csv',
  'topologyImage',
  // §3.13 audit events (improvements M13, #70) — the Report table is the audit hook
  'evidencePurge',
  'secretReveal',
  'retentionSweep',
]);
export type ReportType = z.infer<typeof reportTypeSchema>;

export const reportRecordSchema = z.object({
  id: reportIdSchema,
  projectId: projectIdSchema,
  type: reportTypeSchema,
  createdAt: z.iso.datetime(),
  /** The redaction profile in force; empty = unredacted. */
  redactionProfile: z.string().default(''),
  /** Free-form generation parameters (entity type for CSVs, format, …). */
  parameters: z.record(z.string(), z.string()).default({}),
  /** SHA-256 of the produced output; empty when the output never passed through the server. */
  outputSha256: z.string().default(''),
});
export type ReportRecord = z.infer<typeof reportRecordSchema>;

/**
 * A modelled principal in the mapped environment (ADR-0022) — never a
 * NetPlan Studio user (that is an Access Role). Local identities belong to
 * one host; domain identities span hosts and carry `deviceId: null`.
 */
export const identitySchema = z.object({
  id: identityIdSchema,
  projectId: projectIdSchema,
  scope: identityScopeSchema,
  name: z.string().min(1),
  /** Domain/realm for `scope: 'domain'`; empty for local principals. */
  domain: z.string().default(''),
  kind: identityKindSchema.default('user'),
  /** Host owning a local identity; null for domain-scoped principals. */
  deviceId: deviceIdSchema.nullable().default(null),
  lifecycleState: lifecycleStateSchema,
  notes: z.string().default(''),
});
export type Identity = z.infer<typeof identitySchema>;

/** Identity × privilege × Device (design §3.9), e.g. local administrator on host X. */
export const roleAssignmentSchema = z.object({
  id: roleAssignmentIdSchema,
  projectId: projectIdSchema,
  identityId: identityIdSchema,
  deviceId: deviceIdSchema.nullable().default(null),
  privilege: rolePrivilegeSchema,
  /** Free-text qualifier, e.g. the group name for `groupMember`. */
  detail: z.string().default(''),
  lifecycleState: lifecycleStateSchema,
});
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;

export const policyDirectionSchema = z.enum(['inbound', 'outbound', 'bidirectional']);
export const policyActionSchema = z.enum(['allow', 'deny', 'reject', 'monitor']);

/**
 * An intended rule (ADR-0011) with polymorphic endpoints (ADR-0012) —
 * firewall policy is written network-to-network, not port-to-port.
 */
export const policyRuleSchema = z.object({
  id: policyRuleIdSchema,
  projectId: projectIdSchema,
  name: z.string().default(''),
  source: policyEndpointSchema,
  destination: policyEndpointSchema,
  /** Null means "any service/protocol". */
  serviceId: serviceIdSchema.nullable().default(null),
  direction: policyDirectionSchema.default('bidirectional'),
  action: policyActionSchema,
  logging: z.boolean().default(false),
  owner: z.string().default(''),
  justification: z.string().default(''),
  reviewDate: z.iso.date().nullable().default(null),
  lifecycleState: lifecycleStateSchema,
  notes: z.string().default(''),
});
export type PolicyRule = z.infer<typeof policyRuleSchema>;

/**
 * The scope a Baseline applies to (ADR-0025): a Zone, Network or Device by id.
 * References real model objects, so deleting one surfaces as an orphaned
 * reference (§3.11), the same way an orphaned PolicyRule does.
 */
export const baselineScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('zone'), id: zoneIdSchema }),
  z.object({ kind: z.literal('network'), id: networkIdSchema }),
  z.object({ kind: z.literal('device'), id: deviceIdSchema }),
]);
export type BaselineScope = z.infer<typeof baselineScopeSchema>;

/** One service the operator expects to be present/exposed within the scope. */
export const expectedServiceSchema = z.object({
  protocol: protocolSchema,
  port: z.number().int().min(0).max(65535).nullable().default(null),
  description: z.string().default(''),
});
export type ExpectedService = z.infer<typeof expectedServiceSchema>;

/** One destination the operator expects traffic to/from within the scope. */
export const expectedTrafficSchema = z.object({
  /** An address, CIDR or hostname the scope is expected to communicate with. */
  destination: z.string().min(1),
  description: z.string().default(''),
});
export type ExpectedTraffic = z.infer<typeof expectedTrafficSchema>;

/**
 * An operator-declared statement of expected services / traffic for a scope
 * (ADR-0025) — the yardstick a Finding measures deviation against. A first-class
 * entity edited through the Operation log; Findings cite its id + version.
 */
export const baselineSchema = z.object({
  id: baselineIdSchema,
  projectId: projectIdSchema,
  name: z.string().min(1),
  scope: baselineScopeSchema,
  /** Bumped by the operator on material change; cited by Findings for reproducibility. */
  version: z.number().int().min(1).default(1),
  expectedServices: z.array(expectedServiceSchema).default([]),
  expectedTraffic: z.array(expectedTrafficSchema).default([]),
  lifecycleState: lifecycleStateSchema,
  notes: z.string().default(''),
});
export type Baseline = z.infer<typeof baselineSchema>;
