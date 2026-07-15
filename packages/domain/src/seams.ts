/**
 * Remaining Phase-3/4 seams (ADR-0014): these types exist so later phases are
 * additive — entity tables and the bundle envelope must never be reshaped to
 * add them. Evidence, ImportJob, Observation, FieldProvenance, Flow, Identity
 * and RoleAssignment were promoted to real types in Phase 2; what stays here
 * is not yet wired or persisted.
 */
import { z } from 'zod';
import { projectIdSchema } from './ids.js';
import { policyEndpointSchema } from './endpoints.js';
import { confidenceSchema } from './confidence.js';
import { evidenceIdSchema } from './imports.js';

export const findingIdSchema = z.uuidv7().brand<'FindingId'>();
export type FindingId = z.infer<typeof findingIdSchema>;

export const severitySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);

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
