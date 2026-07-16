import { z } from 'zod';
import { projectIdSchema } from './ids.js';

/**
 * The Egress door (ADR-0027): every outbound network call passes one guarded,
 * audited, opt-in chokepoint. Off by default per project, behind an explicit
 * disclosure. Indicator sensitivity is graded — file-hash lookups ride the
 * main opt-in; IP/domain lookups (which reveal who the client talks to) each
 * need their own explicit opt-in, named in the disclosure (design Q10).
 */

export const egressAuditRecordIdSchema = z.uuidv7().brand<'EgressAuditRecordId'>();
export type EgressAuditRecordId = z.infer<typeof egressAuditRecordIdSchema>;

/** What kind of indicator a door call carries — the unit of the graded opt-in. */
export const indicatorTypeSchema = z.enum(['fileHash', 'ip', 'domain']);
export type IndicatorType = z.infer<typeof indicatorTypeSchema>;

/** Per-project egress door state. `enabled: false` ⇒ provably zero outbound packets. */
export const egressSettingsSchema = z.object({
  projectId: projectIdSchema,
  enabled: z.boolean(),
  /** Set when the operator acknowledged the disclosure (what leaves, to whom). */
  disclosureAcknowledgedAt: z.iso.datetime().nullable(),
  /** Graded opt-in: only these indicator types may leave through the door. */
  allowedIndicatorTypes: z.array(indicatorTypeSchema),
  updatedAt: z.iso.datetime(),
});
export type EgressSettings = z.infer<typeof egressSettingsSchema>;

/** The door state every project starts in: shut, nothing acknowledged. */
export function defaultEgressSettings(
  projectId: z.infer<typeof projectIdSchema>,
  now: string,
): EgressSettings {
  return egressSettingsSchema.parse({
    projectId,
    enabled: false,
    disclosureAcknowledgedAt: null,
    allowedIndicatorTypes: ['fileHash'],
    updatedAt: now,
  });
}

export const egressCallOutcomeSchema = z.enum(['success', 'error', 'blocked']);
export type EgressCallOutcome = z.infer<typeof egressCallOutcomeSchema>;

/**
 * One call through the door (ADR-0027): evidence-grade provenance of what was
 * asked of whom and what came of it. Written for every egress-capable call —
 * including blocked attempts, which never left the machine.
 */
export const egressAuditRecordSchema = z.object({
  id: egressAuditRecordIdSchema,
  projectId: projectIdSchema,
  timestamp: z.iso.datetime(),
  providerId: z.string().min(1),
  indicatorType: indicatorTypeSchema,
  /** The exact query as it would leave (or left) the machine. */
  query: z.string().min(1),
  outcome: egressCallOutcomeSchema,
  /** Block reason or error message; empty on success. */
  detail: z.string().default(''),
});
export type EgressAuditRecord = z.infer<typeof egressAuditRecordSchema>;
