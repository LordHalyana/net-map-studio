import { combineConfidence } from '../confidence.js';
import type { EvidenceId } from '../imports.js';
import type { CorrelationRule, DetectionDraft, DetectionRecord } from './rule.js';
import { numberParam } from './rules/helpers.js';

/**
 * M10 — network-wide correlation capstone (design §3.8). A conservative second
 * pass over the first-pass findings and the graph. Every network-wide finding
 * states the network **may be** compromised, names the correlation logic and
 * shows the evidence chain — never a confirmed-compromise verdict.
 */

const CORRELATION_MIN_HOSTS = 3;

/** Categories whose recurrence across devices is high-signal enough to correlate. */
const CORRELATABLE_CATEGORIES = new Set([
  'known indicator match',
  'masquerading or double-extension',
  'unusual persistence entry',
  'beacon-like periodic communication',
  'unapproved remote-access software',
]);

function affectedDeviceId(detection: DetectionRecord): string | undefined {
  return detection.affected?.kind === 'device' ? detection.affected.id : undefined;
}

function unionEvidence(detections: readonly DetectionRecord[]): EvidenceId[] {
  const seen = new Set<string>();
  const out: EvidenceId[] = [];
  for (const d of detections) {
    for (const ref of d.evidenceRefs) {
      if (!seen.has(ref)) {
        seen.add(ref);
        out.push(ref);
      }
    }
  }
  return out;
}

/**
 * The same known-bad external destination reached by several unrelated devices —
 * the §3.8 "same suspicious destination contacted by several unrelated devices"
 * pattern. Reads the local IoC destination list (no egress) and the Flow graph.
 */
export const sharedIndicatorDestinationRule: CorrelationRule = {
  id: 'correlation.sharedIndicatorDestination',
  ruleVersion: '1.0.0',
  category: 'network-wide compromise assessment',
  defaultSeverity: 'critical',
  correlate(_detections, ctx) {
    const threshold = numberParam(
      ctx.settings.params,
      'correlationMinHosts',
      CORRELATION_MIN_HOSTS,
    );
    const indicators = new Set(ctx.lists.indicatorDestinations.map((d) => d.toLowerCase()));
    if (indicators.size === 0) return [];

    // destination -> map(deviceId -> flow confidence)
    const byDestination = new Map<string, Map<string, number>>();
    for (const flow of ctx.state.flows) {
      if (flow.destination.kind !== 'external') continue;
      const dest = flow.destination.value.toLowerCase();
      if (!indicators.has(dest)) continue;
      const source = ctx.index.flowEndpointDevice(flow.source);
      if (!source) continue;
      const perHost = byDestination.get(dest) ?? new Map<string, number>();
      perHost.set(source.id, Math.max(perHost.get(source.id) ?? 0, flow.confidence));
      byDestination.set(dest, perHost);
    }

    const drafts: DetectionDraft[] = [];
    for (const [dest, perHost] of byDestination) {
      if (perHost.size < threshold) continue;
      const names = ctx.state.devices
        .filter((d) => perHost.has(d.id))
        .map((d) => d.name)
        .sort();
      drafts.push({
        affected: null,
        salientKey: `sharedIndicatorDest:${dest}`,
        title: `Network may be compromised: ${perHost.size} devices contacted known-bad ${dest}`,
        evidenceRefs: [],
        contributingProvenanceRows: [],
        baseConfidence: combineConfidence([...perHost.values()]),
        explanation: `Correlation logic: a destination on the local indicator list (${dest}) was contacted by ${perHost.size} unrelated devices (${names.join(', ')}). The network MAY be compromised — this is not a confirmed verdict. Evidence chain: one Flow per device to ${dest}.`,
        verificationSteps: [
          'Review each host-to-destination Flow and correlate timing.',
          'Contain and triage the affected devices; confirm the indicator against threat intel (Phase 4).',
        ],
      });
    }
    return drafts;
  },
};

/**
 * The same high-signal per-object finding recurring across many devices — the
 * §3.8 "similar persistence / executable indicators across devices" pattern.
 * A finding about findings.
 */
export const widespreadIndicatorRule: CorrelationRule = {
  id: 'correlation.widespreadIndicator',
  ruleVersion: '1.0.0',
  category: 'network-wide compromise assessment',
  defaultSeverity: 'high',
  correlate(detections, ctx) {
    const threshold = numberParam(
      ctx.settings.params,
      'correlationMinHosts',
      CORRELATION_MIN_HOSTS,
    );

    const byCategory = new Map<string, DetectionRecord[]>();
    for (const detection of detections) {
      if (!CORRELATABLE_CATEGORIES.has(detection.category)) continue;
      if (affectedDeviceId(detection) === undefined) continue;
      const list = byCategory.get(detection.category) ?? [];
      list.push(detection);
      byCategory.set(detection.category, list);
    }

    const drafts: DetectionDraft[] = [];
    for (const [category, group] of byCategory) {
      const deviceIds = new Set(group.map(affectedDeviceId));
      if (deviceIds.size < threshold) continue;
      drafts.push({
        affected: null,
        salientKey: `widespread:${category}`,
        title: `Network may be compromised: "${category}" seen on ${deviceIds.size} devices`,
        evidenceRefs: unionEvidence(group),
        contributingProvenanceRows: [],
        baseConfidence: combineConfidence(group.map((d) => d.confidence)),
        explanation: `Correlation logic: the same high-signal indicator ("${category}") was independently detected on ${deviceIds.size} devices. The network MAY be compromised — not a confirmed verdict. Evidence chain: the ${group.length} contributing per-device findings.`,
        verificationSteps: [
          'Compare the per-device findings for a common root cause or delivery vector.',
          'Treat as a possible coordinated compromise until ruled out.',
        ],
      });
    }
    return drafts;
  },
};

export const correlationRules: readonly CorrelationRule[] = [
  sharedIndicatorDestinationRule,
  widespreadIndicatorRule,
];
