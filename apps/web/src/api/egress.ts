import { z } from 'zod';
import {
  egressAuditRecordSchema,
  egressSettingsSchema,
  enrichmentViewSchema,
  localFeedEntrySchema,
  threatIntelLocalFeedSchema,
  type EgressAuditRecord,
  type EgressSettings,
  type EnrichmentView,
  type IndicatorType,
  type LocalFeedEntry,
  type ThreatIntelLocalFeed,
} from '@netplan/domain';
import { apiFetch } from './client';

/** Egress door + threat-intel API surface (P4) — conventions of client.ts. */

export type { EnrichmentView } from '@netplan/domain';

export function getEgressSettings(projectId: string): Promise<EgressSettings> {
  return apiFetch(`/projects/${projectId}/egress/settings`, egressSettingsSchema);
}

export function putEgressSettings(
  projectId: string,
  body: {
    enabled: boolean;
    allowedIndicatorTypes: IndicatorType[];
    acknowledgeDisclosure: boolean;
  },
): Promise<EgressSettings> {
  return apiFetch(`/projects/${projectId}/egress/settings`, egressSettingsSchema, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function listEgressAudit(projectId: string): Promise<EgressAuditRecord[]> {
  return apiFetch(`/projects/${projectId}/egress/audit`, z.array(egressAuditRecordSchema));
}

export function getLocalFeed(projectId: string): Promise<ThreatIntelLocalFeed> {
  return apiFetch(`/projects/${projectId}/threat-intel/feed`, threatIntelLocalFeedSchema);
}

export function putLocalFeed(
  projectId: string,
  entries: LocalFeedEntry[],
): Promise<ThreatIntelLocalFeed> {
  return apiFetch(`/projects/${projectId}/threat-intel/feed`, threatIntelLocalFeedSchema, {
    method: 'PUT',
    body: JSON.stringify({ entries: entries.map((e) => localFeedEntrySchema.parse(e)) }),
  });
}

export function listEnrichments(projectId: string): Promise<EnrichmentView[]> {
  return apiFetch(`/projects/${projectId}/enrichments`, z.array(enrichmentViewSchema));
}

export function fetchEnrichment(
  projectId: string,
  body: { providerId?: string; indicatorType: IndicatorType; query: string },
): Promise<EnrichmentView> {
  return apiFetch(`/projects/${projectId}/enrichments`, enrichmentViewSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
