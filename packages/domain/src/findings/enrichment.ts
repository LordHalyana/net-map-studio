import { z } from 'zod';
import { indicatorTypeSchema } from '../egress.js';
import { projectIdSchema } from '../ids.js';
import { evidenceIdSchema, type Evidence } from '../imports.js';

/**
 * Enrichment (ADR-0028): an externally-sourced annotation about an indicator,
 * fetched through the egress door as a *collection* step and stored as
 * read-only Evidence. Rules consume the stored payload deterministically —
 * never a live call, so detection stays a pure recomputation (ADR-0023).
 */

export const threatIntelVerdictSchema = z.enum(['malicious', 'suspicious', 'benign', 'unknown']);
export type ThreatIntelVerdict = z.infer<typeof threatIntelVerdictSchema>;

/** What a ThreatIntelProvider is asked (Zod-first, ADR-0017). */
export const threatIntelRequestSchema = z.object({
  indicatorType: indicatorTypeSchema,
  /** The exact indicator value — this is what the audit record shows leaving. */
  query: z.string().min(1),
});
export type ThreatIntelRequest = z.infer<typeof threatIntelRequestSchema>;

/** What a ThreatIntelProvider answers (Zod-first, ADR-0017). */
export const threatIntelResponseSchema = z.object({
  verdict: threatIntelVerdictSchema,
  /** Provider-reported score in [0, 1]; null when the provider has none. */
  score: z.number().min(0).max(1).nullable().default(null),
  detail: z.string().default(''),
});
export type ThreatIntelResponse = z.infer<typeof threatIntelResponseSchema>;

/** One entry of the operator-supplied local/offline IoC feed (zero-egress mode). */
export const localFeedEntrySchema = z.object({
  indicatorType: indicatorTypeSchema,
  /** Hash, IP or domain — matched case-insensitively against queries. */
  indicator: z.string().min(1),
  verdict: threatIntelVerdictSchema,
  score: z.number().min(0).max(1).nullable().default(null),
  detail: z.string().default(''),
});
export type LocalFeedEntry = z.infer<typeof localFeedEntrySchema>;

/** The per-project operator-supplied feed the local provider consults. */
export const threatIntelLocalFeedSchema = z.object({
  projectId: projectIdSchema,
  entries: z.array(localFeedEntrySchema),
  updatedAt: z.iso.datetime(),
});
export type ThreatIntelLocalFeed = z.infer<typeof threatIntelLocalFeedSchema>;

export const DEFAULT_ENRICHMENT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * The enrichment Evidence payload (ADR-0028): provider, exact query, raw
 * response, fetched-at and TTL — stored verbatim as the read-only Evidence
 * blob. A verdict change requires a new fetch, i.e. a new Evidence artifact.
 */
export const enrichmentPayloadSchema = z.object({
  kind: z.literal('threatIntelEnrichment'),
  providerId: z.string().min(1),
  indicatorType: indicatorTypeSchema,
  query: z.string().min(1),
  /** The provider's response body, verbatim. */
  rawResponse: z.string(),
  response: threatIntelResponseSchema,
  fetchedAt: z.iso.datetime(),
  ttlSeconds: z.number().int().positive(),
});
export type EnrichmentPayload = z.infer<typeof enrichmentPayloadSchema>;

/**
 * Staleness is presentation-time provenance, never a detection input: rules
 * must not read the clock (that would break re-run determinism, ADR-0023/0028).
 * Views and reports compute it against their own "now".
 */
export function isEnrichmentStale(payload: EnrichmentPayload, nowIso: string): boolean {
  return Date.parse(payload.fetchedAt) + payload.ttlSeconds * 1000 < Date.parse(nowIso);
}

/** An enrichment as a Rule sees it: the Evidence id it can cite plus the payload. */
export interface EnrichmentInput {
  evidenceId: Evidence['id'];
  payload: EnrichmentPayload;
}

/** Parse a stored enrichment Evidence blob; null when it isn't one. */
export function parseEnrichmentEvidence(
  evidenceId: string,
  blobContent: string,
): EnrichmentInput | null {
  let json: unknown;
  try {
    json = JSON.parse(blobContent);
  } catch {
    return null;
  }
  const parsed = enrichmentPayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  return { evidenceId: evidenceIdSchema.parse(evidenceId), payload: parsed.data };
}

/** The one-line provenance phrase reports surface: "enriched by provider X at T". */
export function enrichmentProvenanceLine(payload: EnrichmentPayload): string {
  return `Enriched by ${payload.providerId} at ${payload.fetchedAt} (TTL ${payload.ttlSeconds}s).`;
}
