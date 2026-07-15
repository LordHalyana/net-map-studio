import type { IdentityScope } from '../entities.js';

/**
 * The one natural-key format for a principal (ADR-0022): domain identities
 * key case-insensitively on DOMAIN\name and span hosts; local identities key
 * within their host (`hostRef` is a candidate device key or a Device id,
 * depending on which space the caller matches in — the two spaces never mix).
 * Shared by dedup (candidates) and existing-graph matching (proposal) so the
 * two can never drift apart.
 */
export function identityNaturalKey(
  scope: IdentityScope,
  domain: string,
  name: string,
  hostRef: string,
): string {
  return scope === 'domain'
    ? `identity:domain:${domain.toUpperCase()}\\${name.toLowerCase()}`
    : `identity:local:${hostRef}:${name.toLowerCase()}`;
}
