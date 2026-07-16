import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  defaultEgressSettings,
  egressAuditRecordIdSchema,
  egressAuditRecordSchema,
  egressSettingsSchema,
  indicatorTypeSchema,
  newId,
  projectIdSchema,
  threatIntelRequestSchema,
  type EgressAuditRecord,
  type EgressCallOutcome,
  type EgressSettings,
  type IndicatorType,
  type ThreatIntelRequest,
  type ThreatIntelResponse,
} from '@netplan/domain';
import type { Db } from '../db/index.js';
import { requireProject } from '../db/require-project.js';
import { egressAuditRecords, egressSettings } from '../db/schema.js';
import { OperationError } from '../engine/store.js';
import { stubProvider } from './providers/stub.js';

/**
 * The egress door (ADR-0027): the single guarded chokepoint every outbound
 * network call passes through. Nothing outside this module may own a network
 * client — the architecture test in egress-m1.test.ts fails any other one.
 *
 * Off by default per project; opened only behind the acknowledged disclosure;
 * every egress-capable call (blocked attempts included) writes one audit
 * record. Providers that don't require egress (local/offline feeds) run with
 * the door shut and are not outbound calls, so they don't appear here.
 */

/**
 * What a caller asks the door to send — the domain's ThreatIntelRequest
 * (ADR-0017 single source); the exact query is what gets audited.
 */
export type EgressLookupRequest = ThreatIntelRequest;

export interface ThreatIntelProviderResult {
  /** The raw response body, verbatim — stored as Evidence by callers (ADR-0028). */
  raw: string;
  /** The provider's answer in the canonical ThreatIntelResponse shape (P4-M2). */
  response: ThreatIntelResponse;
}

/**
 * The ThreatIntelProvider seam (ADR-0027): a provider behind the door.
 * `requiresEgress: true` means execute() would leave the machine and is gated
 * by the per-project opt-in; the M1 stub is canned but declares itself
 * egress-requiring so the gate is exercised. Online providers
 * (VirusTotal-style, self-hosted MISP) are future implementations of this
 * interface — do not build them in Phase 4 (plan §4).
 */
export interface ThreatIntelProvider {
  id: string;
  version: string;
  requiresEgress: boolean;
  execute(
    request: EgressLookupRequest,
    ctx: { projectId: string },
  ): Promise<ThreatIntelProviderResult>;
}

/** A call the door refused: egress off, or the indicator type not opted in. */
export class EgressBlockedError extends Error {
  constructor(
    public readonly reason: 'egressDisabled' | 'indicatorTypeNotAllowed',
    message: string,
  ) {
    super(message);
    this.name = 'EgressBlockedError';
  }
}

/** Wire input of PUT /projects/:id/egress/settings. */
export const updateEgressSettingsBodySchema = z.object({
  enabled: z.boolean(),
  allowedIndicatorTypes: z.array(indicatorTypeSchema).default(['fileHash']),
  /**
   * The disclosure gate: enabling egress, or allowing an indicator type not
   * previously allowed, requires acknowledging the disclosure in this request.
   */
  acknowledgeDisclosure: z.boolean().default(false),
});
export type UpdateEgressSettingsBody = z.input<typeof updateEgressSettingsBodySchema>;

export interface EgressCallResult {
  providerId: string;
  providerVersion: string;
  request: EgressLookupRequest;
  raw: string;
  response: ThreatIntelResponse;
  fetchedAt: string;
  /** Null for zero-egress (local/offline) providers — nothing left the machine. */
  auditRecordId: EgressAuditRecord['id'] | null;
}

export type EgressDoor = ReturnType<typeof createEgressDoor>;

export function createEgressDoor(db: Db, options: { providers?: ThreatIntelProvider[] } = {}) {
  const providers = new Map<string, ThreatIntelProvider>(
    (options.providers ?? [stubProvider]).map((p) => [p.id, p]),
  );

  function getProvider(id: string): ThreatIntelProvider {
    const provider = providers.get(id);
    if (!provider) throw new OperationError('INVALID', `Unknown egress provider: ${id}`);
    return provider;
  }

  function getSettings(projectId: string): EgressSettings {
    requireProject(db, projectId);
    const row = db
      .select()
      .from(egressSettings)
      .where(eq(egressSettings.projectId, projectId))
      .get();
    if (row) return egressSettingsSchema.parse(row);
    return defaultEgressSettings(projectIdSchema.parse(projectId), new Date().toISOString());
  }

  function updateSettings(projectId: string, body: UpdateEgressSettingsBody): EgressSettings {
    const desired = updateEgressSettingsBodySchema.parse(body);
    const current = getSettings(projectId);
    const now = new Date().toISOString();

    const enabling = desired.enabled && !current.enabled;
    const widenedTypes = desired.allowedIndicatorTypes.filter(
      (t: IndicatorType) => !current.allowedIndicatorTypes.includes(t),
    );
    if ((enabling || widenedTypes.length > 0) && !desired.acknowledgeDisclosure) {
      throw new OperationError(
        'INVALID',
        enabling
          ? 'Enabling egress requires acknowledging the disclosure (what leaves, to whom)'
          : `Allowing indicator type(s) ${widenedTypes.join(', ')} requires acknowledging the disclosure`,
      );
    }

    const next = egressSettingsSchema.parse({
      projectId,
      enabled: desired.enabled,
      disclosureAcknowledgedAt: desired.acknowledgeDisclosure
        ? now
        : current.disclosureAcknowledgedAt,
      allowedIndicatorTypes: desired.allowedIndicatorTypes,
      updatedAt: now,
    });
    db.insert(egressSettings)
      .values(next)
      .onConflictDoUpdate({ target: egressSettings.projectId, set: next })
      .run();
    return next;
  }

  function writeAudit(
    projectId: string,
    providerId: string,
    request: EgressLookupRequest,
    outcome: EgressCallOutcome,
    detail: string,
  ): EgressAuditRecord {
    const record = egressAuditRecordSchema.parse({
      id: newId(egressAuditRecordIdSchema),
      projectId,
      timestamp: new Date().toISOString(),
      providerId,
      indicatorType: request.indicatorType,
      query: request.query,
      outcome,
      detail,
    });
    db.insert(egressAuditRecords).values(record).run();
    return record;
  }

  /**
   * The chokepoint. Every egress-capable call funnels through here: gate,
   * execute, audit — one audit record per call, blocked attempts included.
   */
  async function call(
    projectId: string,
    providerId: string,
    rawRequest: EgressLookupRequest,
  ): Promise<EgressCallResult> {
    const request = threatIntelRequestSchema.parse(rawRequest);
    const provider = getProvider(providerId);
    const settings = getSettings(projectId);

    // The gates bind what LEAVES the machine (ADR-0027/Q10): zero-egress
    // providers skip them by design — an ip/domain lookup against the local
    // feed reveals nothing to anyone, and the shut-door mode must stay fully
    // usable. Their trace is the enrichment Evidence, not an audit row.
    if (provider.requiresEgress) {
      if (!settings.enabled) {
        const message = 'Egress is disabled for this project — the door is shut';
        writeAudit(projectId, providerId, request, 'blocked', message);
        throw new EgressBlockedError('egressDisabled', message);
      }
      if (!settings.allowedIndicatorTypes.includes(request.indicatorType)) {
        const message = `Indicator type ${request.indicatorType} is not opted in for this project`;
        writeAudit(projectId, providerId, request, 'blocked', message);
        throw new EgressBlockedError('indicatorTypeNotAllowed', message);
      }
    }

    try {
      const result = await provider.execute(request, { projectId });
      const fetchedAt = new Date().toISOString();
      const audit = provider.requiresEgress
        ? writeAudit(projectId, providerId, request, 'success', '')
        : // local/offline providers are collection without egress — their trace
          // is the enrichment Evidence itself (ADR-0028), not an outbound-call row
          null;
      return {
        providerId,
        providerVersion: provider.version,
        request,
        raw: result.raw,
        response: result.response,
        fetchedAt,
        auditRecordId: audit?.id ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider call failed';
      if (provider.requiresEgress) {
        writeAudit(projectId, providerId, request, 'error', message);
      }
      throw error;
    }
  }

  function listAudit(projectId: string): EgressAuditRecord[] {
    requireProject(db, projectId);
    return db
      .select()
      .from(egressAuditRecords)
      .where(eq(egressAuditRecords.projectId, projectId))
      .orderBy(asc(egressAuditRecords.id))
      .all()
      .map((row) => egressAuditRecordSchema.parse(row));
  }

  return { getSettings, updateSettings, call, listAudit };
}
