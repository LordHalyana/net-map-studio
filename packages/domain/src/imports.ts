import { z } from 'zod';
import { changeSetIdSchema, projectIdSchema } from './ids.js';
import { confidenceContributorSchema, confidenceSchema } from './confidence.js';
import {
  addressKindSchema,
  deviceTypeSchema,
  identityKindSchema,
  identityScopeSchema,
  interfaceKindSchema,
  protocolSchema,
  rolePrivilegeSchema,
} from './entities.js';
import { settableEntityTypeSchema } from './operations.js';

/**
 * The import spine (ADR-0019, ADR-0020): Evidence is the read-only source
 * artifact, an ImportJob is one run of the pipeline, and Observations are the
 * neutral per-source claims Adapters emit. Promoted from the Phase-1 seams to
 * real, persisted types — the Phase-1 entity tables are untouched.
 */

export const evidenceIdSchema = z.uuidv7().brand<'EvidenceId'>();
export const importJobIdSchema = z.uuidv7().brand<'ImportJobId'>();
export const observationIdSchema = z.uuidv7().brand<'ObservationId'>();

export type EvidenceId = z.infer<typeof evidenceIdSchema>;
export type ImportJobId = z.infer<typeof importJobIdSchema>;
export type ObservationId = z.infer<typeof observationIdSchema>;

/** Split-by-class retention (ADR-0019). */
export const evidenceContentClassSchema = z.enum(['structured', 'binaryCapture']);
export type EvidenceContentClass = z.infer<typeof evidenceContentClassSchema>;

/**
 * `inline`: the raw bytes live in the evidence store and travel in the
 * bundle's evidence subtree. `hashOnly`: the blob was summarized and dropped
 * (PCAP default) — the hash and manifest entry always survive.
 */
export const evidenceRetentionSchema = z.enum(['inline', 'hashOnly']);
export type EvidenceRetention = z.infer<typeof evidenceRetentionSchema>;

/** An imported source artifact, hashed on ingest and read-only afterwards. */
export const evidenceSchema = z.object({
  id: evidenceIdSchema,
  projectId: projectIdSchema,
  importJobId: importJobIdSchema,
  filename: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().min(0),
  contentClass: evidenceContentClassSchema,
  retention: evidenceRetentionSchema,
  chunkRef: z.string().nullable(),
  parserName: z.string(),
  parserVersion: z.string(),
  collectedAt: z.iso.datetime().nullable(),
  importedAt: z.iso.datetime(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const importJobStatusSchema = z.enum([
  'pending',
  'parsing',
  'review',
  'committed',
  'rolledBack',
  'failed',
  /** P4-M5: parse stopped by the operator before anything committed; resumable. */
  'cancelled',
]);
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;

/** Worker progress granularity (P4-M5): where inside a run a job currently is. */
export const importProgressStageSchema = z.enum(['queued', 'parsing', 'building', 'persisting']);
export type ImportProgressStage = z.infer<typeof importProgressStageSchema>;

/** One run of the import pipeline, with its rollback boundary (ADR-0021). */
export const importJobSchema = z.object({
  id: importJobIdSchema,
  projectId: projectIdSchema,
  status: importJobStatusSchema,
  parserName: z.string(),
  parserVersion: z.string(),
  schemaVersion: z.string(),
  /** Set on commit: the applied ChangeSet is the rollback boundary. */
  changeSetId: changeSetIdSchema.nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  error: z.string().nullable(),
  /** Non-null only while the worker is actively on the job (P4-M5). */
  progressStage: importProgressStageSchema.nullable().default(null),
});
export type ImportJob = z.infer<typeof importJobSchema>;

// ---------------------------------------------------------------------------
// Observations (ADR-0020)
// ---------------------------------------------------------------------------

/**
 * Identity hints correlating a claim to a real host before any entity exists.
 * Deduplication (M2) matches these across sources; adapters never reference
 * entity ids.
 */
export const deviceHintsSchema = z
  .object({
    stableId: z.string().min(1).optional(),
    mac: z.string().min(1).optional(),
    ip: z.string().min(1).optional(),
    hostname: z.string().min(1).optional(),
  })
  .refine((h) => h.stableId ?? h.mac ?? h.ip ?? h.hostname, {
    message: 'device hints need at least one of stableId, mac, ip, hostname',
  });
export type DeviceHints = z.infer<typeof deviceHintsSchema>;

/** A Flow endpoint may be nothing but an address — never invent a Device for it. */
export const flowEndpointHintsSchema = z.object({
  ip: z.string().min(1).optional(),
  mac: z.string().min(1).optional(),
  hostname: z.string().min(1).optional(),
});
export type FlowEndpointHints = z.infer<typeof flowEndpointHintsSchema>;

/** How an identity claim names its principal (ADR-0022). */
export const identityRefSchema = z.object({
  scope: identityScopeSchema,
  name: z.string().min(1),
  /** Domain/realm name for `scope: 'domain'`; empty for local principals. */
  domain: z.string().default(''),
});
export type IdentityRef = z.infer<typeof identityRefSchema>;

const deviceClaimSchema = z.object({
  targetKind: z.literal('device'),
  device: deviceHintsSchema,
  fields: z
    .object({
      name: z.string().min(1),
      deviceType: deviceTypeSchema,
      vendor: z.string(),
      model: z.string(),
      os: z.string(),
      location: z.string(),
    })
    .partial(),
});

const interfaceClaimSchema = z.object({
  targetKind: z.literal('interface'),
  device: deviceHintsSchema,
  /** The interface's own name — its natural key within the device. */
  name: z.string().min(1),
  fields: z.object({ kind: interfaceKindSchema }).partial(),
});

const addressClaimSchema = z.object({
  targetKind: z.literal('address'),
  device: deviceHintsSchema,
  /** Null when the source cannot tell which interface carries the address. */
  interfaceName: z.string().nullable(),
  kind: addressKindSchema,
  value: z.string().min(1),
});

const serviceClaimSchema = z.object({
  targetKind: z.literal('service'),
  device: deviceHintsSchema,
  protocol: protocolSchema,
  port: z.number().int().min(0).max(65535),
  fields: z
    .object({
      name: z.string().min(1),
      process: z.string(),
      description: z.string(),
    })
    .partial(),
});

/** One observed communication; Aggregation collapses these per (source, destination, service). */
const flowClaimSchema = z.object({
  targetKind: z.literal('flow'),
  source: flowEndpointHintsSchema,
  destination: flowEndpointHintsSchema,
  protocol: protocolSchema,
  /** Destination port — the service half of the aggregation key. */
  port: z.number().int().min(0).max(65535).nullable(),
  firstSeen: z.iso.datetime().nullable(),
  lastSeen: z.iso.datetime().nullable(),
  count: z.number().int().min(1).default(1),
});

const identityClaimSchema = z
  .object({
    targetKind: z.literal('identity'),
    /**
     * Host the principal was observed on. Null for a directory-export claim
     * (P4-M3): the directory asserts the principal exists, not where — only
     * domain-scoped principals may be host-less (a local account without a
     * host is meaningless, ADR-0022).
     */
    device: deviceHintsSchema.nullable(),
    identity: identityRefSchema,
    fields: z.object({ kind: identityKindSchema }).partial(),
  })
  .refine((c) => c.device !== null || c.identity.scope === 'domain', {
    message: 'a host-less identity claim must be domain-scoped',
  });

const roleAssignmentClaimSchema = z.object({
  targetKind: z.literal('roleAssignment'),
  device: deviceHintsSchema,
  identity: identityRefSchema,
  privilege: rolePrivilegeSchema,
  /** Free-text qualifier, e.g. the group name for `groupMember`. */
  detail: z.string().default(''),
});

export const observationClaimSchema = z.discriminatedUnion('targetKind', [
  deviceClaimSchema,
  interfaceClaimSchema,
  addressClaimSchema,
  serviceClaimSchema,
  flowClaimSchema,
  identityClaimSchema,
  roleAssignmentClaimSchema,
]);
export type ObservationClaim = z.infer<typeof observationClaimSchema>;
export type ObservationTargetKind = ObservationClaim['targetKind'];

export type DeviceClaim = z.infer<typeof deviceClaimSchema>;
export type InterfaceClaim = z.infer<typeof interfaceClaimSchema>;
export type AddressClaim = z.infer<typeof addressClaimSchema>;
export type ServiceClaim = z.infer<typeof serviceClaimSchema>;
export type FlowClaim = z.infer<typeof flowClaimSchema>;
export type IdentityClaim = z.infer<typeof identityClaimSchema>;
export type RoleAssignmentClaim = z.infer<typeof roleAssignmentClaimSchema>;

/**
 * A neutral, per-source claim about one thing in the environment, before
 * normalization, deduplication and scoring. Adapters emit these and nothing
 * else — they never create entities (ADR-0020).
 */
export const observationSchema = z.object({
  id: observationIdSchema,
  projectId: projectIdSchema,
  importJobId: importJobIdSchema,
  evidenceId: evidenceIdSchema,
  contributor: confidenceContributorSchema,
  observedAt: z.iso.datetime().nullable(),
  claim: observationClaimSchema,
});
export type Observation = z.infer<typeof observationSchema>;

/** What an Adapter emits; the import framework stamps the envelope ids. */
export const observationDraftSchema = observationSchema.omit({
  id: true,
  projectId: true,
  importJobId: true,
  evidenceId: true,
});
export type ObservationDraft = z.infer<typeof observationDraftSchema>;

// ---------------------------------------------------------------------------
// Field provenance sidecar (ADR-0008)
// ---------------------------------------------------------------------------

export const fieldProvenanceIdSchema = z.uuidv7().brand<'FieldProvenanceId'>();
export type FieldProvenanceId = z.infer<typeof fieldProvenanceIdSchema>;

export const provenanceSourceTypeSchema = z.enum(['imported', 'inferred', 'manual']);
export type ProvenanceSourceType = z.infer<typeof provenanceSourceTypeSchema>;

export const provenanceStatusSchema = z.enum(['accepted', 'rejected', 'overridden']);
export type ProvenanceStatus = z.infer<typeof provenanceStatusSchema>;

/**
 * One provenance row, keyed by (entityType, entityId, field). The entity
 * table holds the current accepted value — always equal to the winning
 * (`accepted`) row here; competing observations sit beside it as `rejected`,
 * and a manual override adds an `overridden`-superseding `manual` row.
 */
export const fieldProvenanceSchema = z.object({
  id: fieldProvenanceIdSchema,
  projectId: projectIdSchema,
  entityType: settableEntityTypeSchema,
  entityId: z.uuidv7(),
  field: z.string().min(1),
  sourceType: provenanceSourceTypeSchema,
  evidenceId: evidenceIdSchema.nullable(),
  importJobId: importJobIdSchema.nullable(),
  observationId: observationIdSchema.nullable(),
  confidence: confidenceSchema,
  parserVersion: z.string(),
  status: provenanceStatusSchema,
  observedValue: z.json(),
  observedAt: z.iso.datetime(),
});
export type FieldProvenance = z.infer<typeof fieldProvenanceSchema>;
