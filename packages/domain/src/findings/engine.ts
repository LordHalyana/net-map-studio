import { combineConfidence, confidenceSchema, type Confidence } from '../confidence.js';
import type { Evidence, FieldProvenance } from '../imports.js';
import type { ProjectState } from '../state.js';
import { hashConfig, resolveRuleSettings, type EngineConfig, type RuleSettings } from './config.js';
import type { HostSecurityInventory } from './inputs.js';
import { computeFingerprint } from './fingerprint.js';
import {
  detectionRecordSchema,
  type AnalysisRun,
  type CorrelationRule,
  type DetectionDraft,
  type DetectionRecord,
  type Rule,
  type RuleContext,
  type RuleMeta,
} from './rule.js';

/** Everything the engine needs to run: the committed graph plus its sidecars. */
export interface AnalysisContext {
  state: ProjectState;
  provenance: readonly FieldProvenance[];
  evidence: readonly Evidence[];
  /** Per-Device security telemetry (M5/M6); empty when none was collected. */
  hostInventories?: readonly HostSecurityInventory[];
  config: EngineConfig;
  /** The current Operation-log `seq` — stamped on the run as its watermark. */
  opSeq: number;
}

/**
 * Confidence derived from the provenance a detection rests on (ADR-0023, M3),
 * kept strictly independent of Severity. Corroborated fields score higher via
 * `combineConfidence` (a two-source, exact-MAC finding beats a single OS
 * guess); a draft that names no provenance rows falls back to its own
 * `baseConfidence` (flow/coverage findings), or 0 when it asserts neither.
 *
 * The rule's own `certaintyFactor` then dampens the result: a heuristic rule is
 * less than certain even on trustworthy inputs.
 */
export function deriveConfidence(
  draft: DetectionDraft,
  provenance: readonly FieldProvenance[],
): Confidence {
  const scores = draft.contributingProvenanceRows
    .map((id) => provenance.find((row) => row.id === id)?.confidence)
    .filter((c): c is Confidence => c !== undefined);
  const base = scores.length > 0 ? combineConfidence(scores) : (draft.baseConfidence ?? 0);
  const factor = draft.certaintyFactor ?? 1;
  return confidenceSchema.parse(base * factor);
}

function assemble(
  rule: RuleMeta,
  draft: DetectionDraft,
  settings: RuleSettings,
  configHash: string,
  provenance: readonly FieldProvenance[],
): DetectionRecord {
  // Severity is rule-declared, config-overridable, and never a function of data.
  const severity = settings.severityOverride ?? draft.severityOverride ?? rule.defaultSeverity;
  return detectionRecordSchema.parse({
    fingerprint: computeFingerprint(rule.id, draft.affected, draft.salientKey),
    ruleId: rule.id,
    ruleVersion: rule.ruleVersion,
    configHash,
    category: draft.category ?? rule.category,
    title: draft.title,
    affected: draft.affected,
    evidenceRefs: [...draft.evidenceRefs],
    contributingProvenanceRows: [...draft.contributingProvenanceRows],
    citedBaselineId: draft.citedBaselineId ?? null,
    citedBaselineVersion: draft.citedBaselineVersion ?? null,
    severity,
    confidence: deriveConfidence(draft, provenance),
    explanation: draft.explanation,
    verificationSteps: draft.verificationSteps,
  });
}

/**
 * Run the enabled rules over the context and return the analysis run — a pure
 * recomputation. It never mutates its input and never touches the Operation
 * log (ADR-0023): the derived half of a Finding is analysis *of* the model, not
 * a mutation *of* it.
 */
export function runAnalysis(
  rules: readonly Rule[],
  ctx: AnalysisContext,
  correlationRules: readonly CorrelationRule[] = [],
): AnalysisRun {
  const configHash = hashConfig(ctx.config);
  const detections: DetectionRecord[] = [];
  const ruleContext = (settings: RuleSettings): RuleContext => ({
    state: ctx.state,
    provenance: ctx.provenance,
    evidence: ctx.evidence,
    hostInventories: ctx.hostInventories ?? [],
    settings,
    lists: ctx.config.lists,
  });

  // First pass: per-object detection.
  for (const rule of rules) {
    const settings = resolveRuleSettings(ctx.config, rule.id);
    if (!settings.enabled) continue;
    for (const draft of rule.detect(ruleContext(settings))) {
      detections.push(assemble(rule, draft, settings, configHash, ctx.provenance));
    }
  }

  // Second pass: correlation over the first-pass detections (M10).
  const firstPass = [...detections];
  for (const rule of correlationRules) {
    const settings = resolveRuleSettings(ctx.config, rule.id);
    if (!settings.enabled) continue;
    for (const draft of rule.correlate(firstPass, ruleContext(settings))) {
      detections.push(assemble(rule, draft, settings, configHash, ctx.provenance));
    }
  }

  return { opSeq: ctx.opSeq, configHash, detections };
}
