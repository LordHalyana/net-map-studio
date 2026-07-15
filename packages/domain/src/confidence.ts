import { z } from 'zod';

/** 0 = no confidence, 1 = certain. Always distinct from Severity. */
export const confidenceSchema = z.number().min(0).max(1);
export type Confidence = z.infer<typeof confidenceSchema>;

/**
 * The §3.7 confidence contributors: every Observation names the kind of
 * signal it rests on, and the scoring stage (ADR-0020) maps that to a
 * numeric confidence in one place, testable in isolation.
 */
export const confidenceContributorSchema = z.enum([
  'stableDeviceId',
  'exactMacMatch',
  'ipSameScanWindow',
  'hostnameMatch',
  'osFingerprint',
  'bannerInference',
  'trafficObservation',
  'supplementalText',
  /** P4-M3: a principal asserted by an authoritative directory export (LDIF). */
  'directoryExport',
]);
export type ConfidenceContributor = z.infer<typeof confidenceContributorSchema>;

/** §3.7: exact MAC / stable device id = strong … single text result = low. */
export const CONFIDENCE_CONTRIBUTOR_SCORES: Record<ConfidenceContributor, Confidence> = {
  stableDeviceId: 0.9,
  exactMacMatch: 0.85,
  ipSameScanWindow: 0.7,
  hostnameMatch: 0.6,
  osFingerprint: 0.45,
  bannerInference: 0.4,
  trafficObservation: 0.3,
  supplementalText: 0.15,
  directoryExport: 0.85,
};

export function contributorScore(contributor: ConfidenceContributor): Confidence {
  return CONFIDENCE_CONTRIBUTOR_SCORES[contributor];
}

/**
 * Corroboration combine: independent observations of the same value each
 * remove a share of the remaining doubt (1 - Π(1 - sᵢ)). Monotonic — more
 * agreeing sources never lower confidence — and never reaches 1 on its own;
 * only a manual override is certain.
 */
export function combineConfidence(scores: readonly Confidence[]): Confidence {
  const doubt = scores.reduce((acc, score) => acc * (1 - confidenceSchema.parse(score)), 1);
  return 1 - doubt;
}
