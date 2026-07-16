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

/** Egress door + threat-intel API surface (P4) — conventions of client.ts. */

const BASE = '/api';

async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        message = body.error;
      }
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  return schema.parse(await response.json());
}

export type { EnrichmentView } from '@netplan/domain';

export function getEgressSettings(projectId: string): Promise<EgressSettings> {
  return api(`/projects/${projectId}/egress/settings`, egressSettingsSchema);
}

export function putEgressSettings(
  projectId: string,
  body: {
    enabled: boolean;
    allowedIndicatorTypes: IndicatorType[];
    acknowledgeDisclosure: boolean;
  },
): Promise<EgressSettings> {
  return api(`/projects/${projectId}/egress/settings`, egressSettingsSchema, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function listEgressAudit(projectId: string): Promise<EgressAuditRecord[]> {
  return api(`/projects/${projectId}/egress/audit`, z.array(egressAuditRecordSchema));
}

export function getLocalFeed(projectId: string): Promise<ThreatIntelLocalFeed> {
  return api(`/projects/${projectId}/threat-intel/feed`, threatIntelLocalFeedSchema);
}

export function putLocalFeed(
  projectId: string,
  entries: LocalFeedEntry[],
): Promise<ThreatIntelLocalFeed> {
  return api(`/projects/${projectId}/threat-intel/feed`, threatIntelLocalFeedSchema, {
    method: 'PUT',
    body: JSON.stringify({ entries: entries.map((e) => localFeedEntrySchema.parse(e)) }),
  });
}

export function listEnrichments(projectId: string): Promise<EnrichmentView[]> {
  return api(`/projects/${projectId}/enrichments`, z.array(enrichmentViewSchema));
}

export function fetchEnrichment(
  projectId: string,
  body: { providerId?: string; indicatorType: IndicatorType; query: string },
): Promise<EnrichmentView> {
  return api(`/projects/${projectId}/enrichments`, enrichmentViewSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
