import type { DetectionDraft, Rule } from '../rule.js';
import type { EnrichmentInput } from '../enrichment.js';
import { enrichmentProvenanceLine } from '../enrichment.js';
import { flowEndpointDevice, inventoryEvidence, pathCandidates } from './helpers.js';

/**
 * P4-M2 (ADR-0028): rules that consume stored enrichment Evidence — the P3
 * local-indicator-matcher seam grown up. Detection reads only `ctx.enrichments`
 * (cached, read-only payloads); it never calls a provider and never reads the
 * clock, so re-running analysis over unchanged enrichment Evidence yields
 * identical findings. Staleness is surfaced at presentation time, not here.
 */

/** Only adverse verdicts produce findings; benign/unknown enrichments are context. */
function adverse(enrichment: EnrichmentInput): boolean {
  const verdict = enrichment.payload.response.verdict;
  return verdict === 'malicious' || verdict === 'suspicious';
}

/** Malicious keeps the rule's critical default; suspicious lands one notch down. */
function adverseSeverityOverride(enrichment: EnrichmentInput): 'high' | undefined {
  return enrichment.payload.response.verdict === 'suspicious' ? 'high' : undefined;
}

/** The shared explanation tail: provenance line plus the provider's own detail. */
function enrichmentExplanationSuffix(enrichment: EnrichmentInput): string {
  const { payload } = enrichment;
  return (
    enrichmentProvenanceLine(payload) +
    (payload.response.detail ? ` Provider detail: ${payload.response.detail}` : '')
  );
}

const REFETCH_STEP = 'Re-fetch the enrichment through the egress door if it is stale.';

export const enrichmentFileHashRule: Rule = {
  id: 'enrichment.fileHashMatch',
  ruleVersion: '1.0.0',
  category: 'known indicator match',
  defaultSeverity: 'critical',
  detect(ctx) {
    const enrichments = ctx.enrichments.filter(
      (e) => e.payload.indicatorType === 'fileHash' && adverse(e),
    );
    if (enrichments.length === 0) return [];
    const byHash = new Map(enrichments.map((e) => [e.payload.query.toLowerCase(), e] as const));

    const drafts: DetectionDraft[] = [];
    for (const inv of ctx.hostInventories) {
      for (const candidate of pathCandidates(inv)) {
        if (!candidate.sha256) continue;
        const enrichment = byHash.get(candidate.sha256.toLowerCase());
        if (!enrichment) continue;
        const { payload } = enrichment;
        drafts.push({
          affected: { kind: 'device', id: inv.deviceId },
          salientKey: `enrichment:${payload.query.toLowerCase()}:${candidate.path}`,
          title: `Threat-intel match: ${candidate.filename} is ${payload.response.verdict}`,
          evidenceRefs: [enrichment.evidenceId, ...inventoryEvidence(inv)],
          contributingProvenanceRows: [],
          baseConfidence: 0.9,
          severityOverride: adverseSeverityOverride(enrichment),
          explanation:
            `"${candidate.path}" matches an indicator rated ${payload.response.verdict} by threat intel. ` +
            enrichmentExplanationSuffix(enrichment),
          verificationSteps: [
            'Isolate and triage the device; verify the file hash independently.',
            REFETCH_STEP,
          ],
        });
      }
    }
    return drafts;
  },
};

export const enrichmentDestinationRule: Rule = {
  id: 'enrichment.indicatorDestination',
  ruleVersion: '1.0.0',
  category: 'known indicator match',
  defaultSeverity: 'critical',
  detect(ctx) {
    const enrichments = ctx.enrichments.filter(
      (e) =>
        (e.payload.indicatorType === 'ip' || e.payload.indicatorType === 'domain') && adverse(e),
    );
    if (enrichments.length === 0) return [];
    const byIndicator = new Map(
      enrichments.map((e) => [e.payload.query.toLowerCase(), e] as const),
    );

    const drafts: DetectionDraft[] = [];
    for (const flow of ctx.state.flows) {
      if (flow.destination.kind !== 'external') continue;
      const enrichment = byIndicator.get(flow.destination.value.toLowerCase());
      if (!enrichment) continue;
      const source = flowEndpointDevice(ctx.state, flow.source);
      if (!source) continue;
      const { payload } = enrichment;
      drafts.push({
        affected: { kind: 'device', id: source.id },
        salientKey: `enrichment:${payload.query.toLowerCase()}`,
        title: `Threat-intel match: traffic to ${payload.response.verdict} destination ${flow.destination.value}`,
        evidenceRefs: [enrichment.evidenceId],
        contributingProvenanceRows: [],
        baseConfidence: flow.confidence,
        severityOverride: adverseSeverityOverride(enrichment),
        explanation:
          `${source.name} communicated with ${flow.destination.value}, an indicator rated ` +
          `${payload.response.verdict} by threat intel. ` +
          enrichmentExplanationSuffix(enrichment),
        verificationSteps: [
          'Review the Flow (count, first/last seen) and correlate with other devices.',
          REFETCH_STEP,
        ],
      });
    }
    return drafts;
  },
};

export const enrichmentRules: readonly Rule[] = [enrichmentFileHashRule, enrichmentDestinationRule];
