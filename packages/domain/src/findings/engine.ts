import { combineConfidence, confidenceSchema, type Confidence } from '../confidence.js';
import type { Evidence, FieldProvenance } from '../imports.js';
import type { ProjectState } from '../state.js';
import { hashConfig, resolveRuleSettings, type EngineConfig, type RuleSettings } from './config.js';
import { computeFingerprint } from './fingerprint.js';
import {
  detectionRecordSchema,
  type AnalysisRun,
  type DetectionDraft,
  type DetectionRecord,
  type Rule,
  type RuleContext,
} from './rule.js';

/** Everything the engine needs to run: the committed graph plus its sidecars. */
export interface AnalysisContext {
  state: ProjectState;
  provenance: readonly FieldProvenance[];
  evidence: readonly Evidence[];
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
  rule: Rule,
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
export function runAnalysis(rules: readonly Rule[], ctx: AnalysisContext): AnalysisRun {
  const configHash = hashConfig(ctx.config);
  const detections: DetectionRecord[] = [];
  for (const rule of rules) {
    const settings = resolveRuleSettings(ctx.config, rule.id);
    if (!settings.enabled) continue;
    const ruleCtx: RuleContext = {
      state: ctx.state,
      provenance: ctx.provenance,
      evidence: ctx.evidence,
      settings,
      lists: ctx.config.lists,
    };
    for (const draft of rule.detect(ruleCtx)) {
      detections.push(assemble(rule, draft, settings, configHash, ctx.provenance));
    }
  }
  return { opSeq: ctx.opSeq, configHash, detections };
}
