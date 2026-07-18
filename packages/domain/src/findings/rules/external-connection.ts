import type { Flow } from '../../entities.js';
import type { DetectionDraft, Rule } from '../rule.js';
import { applicableBaselines, numberParam } from './helpers.js';

/**
 * M8 — external-connection family (design §3.8): unexpected external
 * destinations (vs the expected-traffic Baseline) and beacon-like periodic
 * communication over aggregated Flows. A destination with no known Device is
 * handled without fabricating one (consistent with Phase-2 M6): the finding
 * scopes to the known internal endpoint and names the external peer as a string.
 */

function externalValue(ep: Flow['source']): string | undefined {
  return ep.kind === 'external' ? ep.value : undefined;
}

/** Expected-traffic match: exact host, or a leading-dot domain suffix (.example.com). */
function trafficMatches(pattern: string, value: string): boolean {
  const p = pattern.toLowerCase();
  const v = value.toLowerCase();
  if (p === v) return true;
  return p.startsWith('.') && v.endsWith(p);
}

export const unexpectedExternalDestinationRule: Rule = {
  id: 'flow.unexpectedExternalDestination',
  ruleVersion: '1.0.0',
  category: 'unexpected external destination',
  defaultSeverity: 'medium',
  detect(ctx) {
    const drafts: DetectionDraft[] = [];
    for (const flow of ctx.state.flows) {
      const dest = externalValue(flow.destination);
      if (dest === undefined) continue;
      const source = ctx.index.flowEndpointDevice(flow.source);
      if (!source) continue; // no internal scope to measure expectation against

      const baselines = applicableBaselines(ctx, source);
      if (baselines.length === 0) continue; // no expected-traffic yardstick governs this scope
      const expected = baselines.some((b) =>
        b.expectedTraffic.some((t) => trafficMatches(t.destination, dest)),
      );
      if (expected) continue;

      drafts.push({
        affected: { kind: 'device', id: source.id },
        salientKey: `extDest:${dest.toLowerCase()}`,
        title: `Unexpected external destination: ${dest}`,
        evidenceRefs: [],
        contributingProvenanceRows: [],
        // Cite the expected-traffic Baseline this deviates from (ADR-0025).
        citedBaselineId: baselines[0]?.id ?? null,
        citedBaselineVersion: baselines[0]?.version ?? null,
        baseConfidence: flow.confidence,
        explanation: `${source.name} communicates with external destination ${dest}, which is outside the expected-traffic Baseline for its scope.`,
        verificationSteps: [
          'Confirm whether this destination is legitimate business traffic.',
          'If legitimate, add it to the expected-traffic Baseline; otherwise investigate the source host.',
        ],
      });
    }
    return drafts;
  },
};

export const beaconLikeRule: Rule = {
  id: 'flow.beaconLike',
  ruleVersion: '1.0.0',
  category: 'beacon-like periodic communication',
  defaultSeverity: 'high',
  detect(ctx) {
    const minCount = numberParam(ctx.settings.params, 'beaconMinCount', 12);
    const minSpanMinutes = numberParam(ctx.settings.params, 'beaconMinSpanMinutes', 60);
    const minIntervalMinutes = numberParam(ctx.settings.params, 'beaconMinIntervalMinutes', 1);
    const maxIntervalMinutes = numberParam(ctx.settings.params, 'beaconMaxIntervalMinutes', 1440);

    const drafts: DetectionDraft[] = [];
    for (const flow of ctx.state.flows) {
      if (flow.observationCount < minCount) continue;
      const spanMinutes = (Date.parse(flow.lastSeen) - Date.parse(flow.firstSeen)) / 60000;
      if (!Number.isFinite(spanMinutes) || spanMinutes < minSpanMinutes) continue;
      const interval = spanMinutes / (flow.observationCount - 1);
      if (interval < minIntervalMinutes || interval > maxIntervalMinutes) continue;

      const source = ctx.index.flowEndpointDevice(flow.source);
      const dest =
        externalValue(flow.destination) ?? ctx.index.flowEndpointDevice(flow.destination)?.name;
      drafts.push({
        affected: source ? { kind: 'device', id: source.id } : null,
        salientKey: `beacon:${flow.id}`,
        title: `Beacon-like periodic communication${dest ? ` to ${dest}` : ''}`,
        evidenceRefs: [],
        contributingProvenanceRows: [],
        baseConfidence: flow.confidence,
        // Periodicity inferred from an aggregate is heuristic — dampen confidence.
        certaintyFactor: 0.7,
        explanation: `${flow.observationCount} connections over ~${Math.round(spanMinutes)} min (≈ every ${Math.round(interval)} min) resemble automated beaconing.`,
        verificationSteps: [
          'Inspect the raw flow timing for regular intervals characteristic of C2 beaconing.',
          'Correlate the destination with known-indicator lists and other devices (M10).',
        ],
      });
    }
    return drafts;
  },
};

export const externalConnectionRules: readonly Rule[] = [
  unexpectedExternalDestinationRule,
  beaconLikeRule,
];
