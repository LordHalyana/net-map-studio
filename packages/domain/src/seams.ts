/**
 * Remaining Phase-4 seams (ADR-0014): types that exist so later phases are
 * additive — entity tables and the bundle envelope must never be reshaped to
 * add them.
 *
 * The Phase-3 Finding was promoted here in Phase 3: its two halves now live as
 * a derived `DetectionRecord` (`findings/rule.ts`) and a persisted
 * `FindingDisposition` (`findings/disposition.ts`), joined by a Fingerprint
 * (ADR-0023). `findingIdSchema` moved to `ids.ts`. Severity stays here because
 * it is a cross-cutting scale, not owned by the findings subtree.
 */
import { z } from 'zod';

export const severitySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof severitySchema>;

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
