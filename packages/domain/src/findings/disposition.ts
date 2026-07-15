import { z } from 'zod';
import { findingIdSchema, projectIdSchema } from '../ids.js';

/**
 * The *persisted* half of a Finding (ADR-0023): the analyst workflow. Unlike
 * the derived detection, a disposition is a durable human decision — so it is a
 * first-class entity mutated only through the Operation log (ADR-0010), keyed
 * to detection by Fingerprint. Its audit trail is the Operation log itself.
 */

export const findingStatusSchema = z.enum([
  'new',
  'acknowledged',
  'underReview',
  'falsePositive',
  'acceptedRisk',
  'resolved',
]);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

/** The status a Finding holds before any operator has dispositioned it. */
export const INITIAL_FINDING_STATUS: FindingStatus = 'new';

export const findingDispositionSchema = z.object({
  id: findingIdSchema,
  projectId: projectIdSchema,
  /** The join key to the derived detection (ADR-0023). */
  fingerprint: z.string().min(1),
  status: findingStatusSchema,
  notes: z.string().default(''),
});
export type FindingDisposition = z.infer<typeof findingDispositionSchema>;
