/**
 * Remaining Phase-2/3 seams (ADR-0014): these types exist so later phases are
 * additive — entity tables and the bundle envelope must never be reshaped to
 * add them. Evidence, ImportJob and Observation were promoted to `imports.ts`
 * in Phase 2; what stays here is not yet wired or persisted.
 */
import { z } from 'zod';
import { projectIdSchema, serviceIdSchema } from './ids.js';
import { policyEndpointSchema } from './endpoints.js';
import { confidenceSchema } from './confidence.js';
import { evidenceIdSchema, importJobIdSchema } from './imports.js';

export const flowIdSchema = z.uuidv7().brand<'FlowId'>();
export const findingIdSchema = z.uuidv7().brand<'FindingId'>();

export type FlowId = z.infer<typeof flowIdSchema>;
export type FindingId = z.infer<typeof findingIdSchema>;

export const severitySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);

/**
 * Per-field provenance sidecar (ADR-0008), keyed by (entityType, entityId,
 * field). Entity tables hold the current accepted value; this sidecar holds
 * where it came from and competing observations. Phase 2 (plan M2).
 */
export const fieldProvenanceSchema = z.object({
  entityType: z.string(),
  entityId: z.uuidv7(),
  field: z.string(),
  sourceType: z.enum(['imported', 'inferred', 'manual']),
  evidenceId: evidenceIdSchema.nullable(),
  importJobId: importJobIdSchema.nullable(),
  confidence: confidenceSchema,
  parserVersion: z.string(),
  status: z.enum(['accepted', 'rejected', 'overridden']),
  observedValue: z.json(),
  observedAt: z.iso.datetime(),
});
export type FieldProvenance = z.infer<typeof fieldProvenanceSchema>;

/** An observed communication (ADR-0011). High-cardinality, time-windowed. Phase 2 (plan M2). */
export const flowSchema = z.object({
  id: flowIdSchema,
  projectId: projectIdSchema,
  source: policyEndpointSchema,
  destination: policyEndpointSchema,
  serviceId: serviceIdSchema.nullable(),
  firstSeen: z.iso.datetime(),
  lastSeen: z.iso.datetime(),
  observationCount: z.number().int().min(1),
  confidence: confidenceSchema,
});
export type Flow = z.infer<typeof flowSchema>;

/**
 * NetPlan Studio application Access Role (design §3.9) — who may do what in
 * the tool, strictly separate from a modelled Identity. Modellable as data,
 * not enforced until multi-user lands (ADR-0001).
 */
export const accessRoleSchema = z.object({
  name: z.enum([
    'administrator',
    'networkEngineer',
    'securityAnalyst',
    'operator',
    'reviewer',
    'viewer',
  ]),
  /** Capability-based so deployments can define custom roles later. */
  capabilities: z.array(z.string()),
});
export type AccessRole = z.infer<typeof accessRoleSchema>;

/** An advisory warning — never a confirmed-compromise verdict. Phase 3. */
export const findingSchema = z.object({
  id: findingIdSchema,
  projectId: projectIdSchema,
  category: z.string(),
  title: z.string(),
  affected: policyEndpointSchema.nullable(),
  severity: severitySchema,
  confidence: confidenceSchema,
  evidenceIds: z.array(evidenceIdSchema),
  ruleId: z.string(),
  ruleVersion: z.string(),
  explanation: z.string(),
  verificationSteps: z.array(z.string()),
  status: z.enum([
    'new',
    'acknowledged',
    'underReview',
    'falsePositive',
    'acceptedRisk',
    'resolved',
  ]),
  notes: z.string(),
});
export type Finding = z.infer<typeof findingSchema>;
