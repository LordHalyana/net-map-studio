import { eq } from 'drizzle-orm';
import {
  localFeedEntrySchema,
  threatIntelLocalFeedSchema,
  threatIntelResponseSchema,
  type LocalFeedEntry,
  type ThreatIntelLocalFeed,
} from '@netplan/domain';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { requireProject } from '../../db/require-project.js';
import { threatIntelLocalFeeds } from '../../db/schema.js';
import type {
  EgressLookupRequest,
  ThreatIntelProvider,
  ThreatIntelProviderResult,
} from '../door.js';

/**
 * The local/offline threat-intel feed (P4-M2, ADR-0027/0028): the operator
 * supplies the IoC set, lookups never leave the machine, and the whole
 * enrichment workflow stays usable with the egress door shut. This is the only
 * concrete ThreatIntelProvider Phase 4 ships.
 */

export const putLocalFeedBodySchema = z.object({
  entries: z.array(localFeedEntrySchema),
});

export type LocalFeedStore = ReturnType<typeof createLocalFeedStore>;

export function createLocalFeedStore(db: Db) {
  function get(projectId: string): ThreatIntelLocalFeed {
    requireProject(db, projectId);
    const row = db
      .select()
      .from(threatIntelLocalFeeds)
      .where(eq(threatIntelLocalFeeds.projectId, projectId))
      .get();
    if (row) return threatIntelLocalFeedSchema.parse(row);
    return threatIntelLocalFeedSchema.parse({
      projectId,
      entries: [],
      updatedAt: new Date().toISOString(),
    });
  }

  function put(projectId: string, entries: LocalFeedEntry[]): ThreatIntelLocalFeed {
    requireProject(db, projectId);
    const next = threatIntelLocalFeedSchema.parse({
      projectId,
      entries,
      updatedAt: new Date().toISOString(),
    });
    db.insert(threatIntelLocalFeeds)
      .values(next)
      .onConflictDoUpdate({ target: threatIntelLocalFeeds.projectId, set: next })
      .run();
    return next;
  }

  return { get, put };
}

export function createLocalFeedProvider(store: LocalFeedStore): ThreatIntelProvider {
  return {
    id: 'local-feed',
    version: '1.0.0',
    requiresEgress: false,
    execute(
      request: EgressLookupRequest,
      ctx: { projectId: string },
    ): Promise<ThreatIntelProviderResult> {
      const feed = store.get(ctx.projectId);
      const entry = feed.entries.find(
        (e) =>
          e.indicatorType === request.indicatorType &&
          e.indicator.toLowerCase() === request.query.toLowerCase(),
      );
      const response = threatIntelResponseSchema.parse(
        entry
          ? { verdict: entry.verdict, score: entry.score, detail: entry.detail }
          : { verdict: 'unknown', score: null, detail: 'indicator not in the local feed' },
      );
      return Promise.resolve({
        raw: JSON.stringify({
          provider: 'local-feed',
          feedUpdatedAt: feed.updatedAt,
          indicatorType: request.indicatorType,
          indicator: request.query,
          matched: entry !== undefined,
          ...response,
        }),
        response,
      });
    },
  };
}
