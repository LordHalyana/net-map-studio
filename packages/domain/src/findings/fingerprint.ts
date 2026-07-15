import type { PolicyEndpoint } from '../endpoints.js';
import { stableHash } from './hash.js';

/**
 * The Fingerprint (ADR-0023) is the stable identity of a Finding across
 * re-analysis: two runs that detect the same real issue on the same object
 * produce the same Fingerprint, so an analyst's disposition survives re-runs
 * and re-imports. It is derived from `(ruleId, affected object, salient key)`.
 */

/** A canonical string for the affected endpoint; `*` for a network-wide finding. */
export function affectedKey(affected: PolicyEndpoint | null): string {
  return affected ? `${affected.kind}:${affected.id}` : 'network:*';
}

export function computeFingerprint(
  ruleId: string,
  affected: PolicyEndpoint | null,
  salientKey: string,
): string {
  return stableHash(ruleId, affectedKey(affected), salientKey);
}
