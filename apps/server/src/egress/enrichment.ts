import { createHash } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import {
  DEFAULT_ENRICHMENT_TTL_SECONDS,
  enrichmentPayloadSchema,
  evidenceIdSchema,
  evidenceSchema,
  importJobIdSchema,
  importJobSchema,
  indicatorTypeSchema,
  isEnrichmentStale,
  newId,
  parseEnrichmentEvidence,
  type EnrichmentInput,
  type Evidence,
} from '@netplan/domain';
import type { Db } from '../db/index.js';
import { evidence as evidenceTable, evidenceBlobs, importJobs } from '../db/schema.js';
import type { EgressDoor } from './door.js';

/**
 * Enrichment as collection (ADR-0028): a fetch through the egress door becomes
 * a read-only Evidence artifact — provider, exact query, raw response,
 * fetched-at, TTL — under a synthetic committed ImportJob, so it travels in
 * bundles, survives like any evidence, and detection can cite it. Re-fetching
 * never mutates: a verdict change is a *new* Evidence artifact.
 */

/** Enrichment jobs carry this parser-name prefix; the suffix is the provider id. */
export const ENRICHMENT_PARSER_PREFIX = 'threat-intel:';

export const fetchEnrichmentBodySchema = z.object({
  providerId: z.string().min(1).default('local-feed'),
  indicatorType: indicatorTypeSchema,
  query: z.string().min(1),
  ttlSeconds: z.number().int().positive().default(DEFAULT_ENRICHMENT_TTL_SECONDS),
});
export type FetchEnrichmentBody = z.input<typeof fetchEnrichmentBodySchema>;

export interface EnrichmentView {
  evidenceId: Evidence['id'];
  payload: EnrichmentInput['payload'];
  /** Computed against "now" at read time — presentation, never a detection input. */
  stale: boolean;
}

export type EnrichmentService = ReturnType<typeof createEnrichmentService>;

export function createEnrichmentService(db: Db, door: EgressDoor) {
  /**
   * Fetch an indicator through the door (gate + audit live there) and store
   * the result as read-only Evidence. Throws EgressBlockedError when the door
   * refuses — nothing is stored for a blocked call; the audit row is its trace.
   */
  async function fetch(projectId: string, body: FetchEnrichmentBody): Promise<EnrichmentView> {
    const parsed = fetchEnrichmentBodySchema.parse(body);
    const result = await door.call(projectId, parsed.providerId, {
      indicatorType: parsed.indicatorType,
      query: parsed.query,
    });

    const payload = enrichmentPayloadSchema.parse({
      kind: 'threatIntelEnrichment',
      providerId: result.providerId,
      indicatorType: parsed.indicatorType,
      query: parsed.query,
      rawResponse: result.raw,
      response: result.response,
      fetchedAt: result.fetchedAt,
      ttlSeconds: parsed.ttlSeconds,
    });
    const content = JSON.stringify(payload);
    const bytes = Buffer.from(content, 'utf8');
    const now = result.fetchedAt;

    // A synthetic, immediately-committed ImportJob: the fetch *is* one run of
    // a collection pipeline (ADR-0028), with no proposal to review.
    const job = importJobSchema.parse({
      id: newId(importJobIdSchema),
      projectId,
      status: 'committed',
      parserName: `${ENRICHMENT_PARSER_PREFIX}${result.providerId}`,
      parserVersion: result.providerVersion,
      schemaVersion: '1',
      changeSetId: null,
      startedAt: now,
      finishedAt: now,
      error: null,
    });
    const record = evidenceSchema.parse({
      id: newId(evidenceIdSchema),
      projectId,
      importJobId: job.id,
      filename: `enrichment-${parsed.indicatorType}-${sanitize(parsed.query)}.json`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
      contentClass: 'structured',
      retention: 'inline',
      chunkRef: null,
      parserName: job.parserName,
      parserVersion: job.parserVersion,
      collectedAt: now,
      importedAt: now,
    });
    db.transaction((tx) => {
      tx.insert(importJobs).values(job).run();
      tx.insert(evidenceTable).values(record).run();
      tx.insert(evidenceBlobs).values({ evidenceId: record.id, encoding: 'utf8', content }).run();
    });

    return { evidenceId: record.id, payload, stale: false };
  }

  /** Every stored enrichment for a project, freshest reading of staleness included. */
  function list(projectId: string): EnrichmentView[] {
    const now = new Date().toISOString();
    return loadEnrichments(projectId).map((e) => ({
      evidenceId: e.evidenceId,
      payload: e.payload,
      stale: isEnrichmentStale(e.payload, now),
    }));
  }

  /** The rule-engine input (P4-M2): parsed payloads with no staleness computed. */
  function loadEnrichments(projectId: string): EnrichmentInput[] {
    const rows = db
      .select({
        evidenceId: evidenceTable.id,
        content: evidenceBlobs.content,
      })
      .from(evidenceTable)
      .innerJoin(evidenceBlobs, eq(evidenceBlobs.evidenceId, evidenceTable.id))
      .where(
        and(
          eq(evidenceTable.projectId, projectId),
          like(evidenceTable.parserName, `${ENRICHMENT_PARSER_PREFIX}%`),
        ),
      )
      .orderBy(evidenceTable.id)
      .all();
    return rows.flatMap((row) => parseEnrichmentEvidence(row.evidenceId, row.content) ?? []);
  }

  return { fetch, list, loadEnrichments };
}

function sanitize(query: string): string {
  return query.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
}
