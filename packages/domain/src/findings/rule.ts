import { z } from 'zod';
import { policyEndpointSchema, type PolicyEndpoint } from '../endpoints.js';
import { confidenceSchema, type Confidence } from '../confidence.js';
import { severitySchema, type Severity } from '../seams.js';
import { evidenceIdSchema, fieldProvenanceIdSchema } from '../imports.js';
import type { Evidence, FieldProvenance } from '../imports.js';
import type { ProjectState } from '../state.js';
import type { IndicatorLists, RuleSettings } from './config.js';

/**
 * A Finding's *derived* half (ADR-0023): the output of a Rule over the
 * committed graph, provenance and evidence. It is a pure recomputation, cached
 * per analysis run and **never written through the Operation log** — it carries
 * no operation, no persisted id, only the Fingerprint that joins it to its
 * durable disposition.
 */
export const detectionRecordSchema = z.object({
  /** Stable join key to the disposition (ADR-0023). See `computeFingerprint`. */
  fingerprint: z.string().min(1),
  ruleId: z.string().min(1),
  /** The code-logic version, bumped when detection logic changes. */
  ruleVersion: z.string().min(1),
  /** The config hash in force for this run — reproducibility (ADR-0024). */
  configHash: z.string().min(1),
  category: z.string().min(1),
  title: z.string().min(1),
  /** The primary affected object; null means network-wide (M10). */
  affected: policyEndpointSchema.nullable(),
  evidenceRefs: z.array(evidenceIdSchema),
  /** The provenance rows this detection rests on — makes Confidence recomputable. */
  contributingProvenanceRows: z.array(fieldProvenanceIdSchema),
  severity: severitySchema,
  confidence: confidenceSchema,
  explanation: z.string(),
  verificationSteps: z.array(z.string()),
});
export type DetectionRecord = z.infer<typeof detectionRecordSchema>;

/**
 * What a Rule's `detect` returns for one issue. The engine assembles the final
 * `DetectionRecord` from it — computing the Fingerprint, stamping ruleId /
 * ruleVersion / configHash, and resolving Severity and Confidence — so a rule
 * never has to know about hashing or config resolution.
 */
export interface DetectionDraft {
  affected: PolicyEndpoint | null;
  /** The salient evidence key: what makes this issue distinct on this object. */
  salientKey: string;
  /** Defaults to the rule's `category` when omitted. */
  category?: string;
  title: string;
  evidenceRefs: readonly Evidence['id'][];
  contributingProvenanceRows: readonly FieldProvenance['id'][];
  /**
   * Confidence for findings that do not rest on FieldProvenance rows (e.g.
   * flow-based, where a Flow carries its own confidence, or coverage findings).
   * When omitted, the engine derives confidence from `contributingProvenanceRows`.
   */
  baseConfidence?: Confidence;
  /**
   * A rule-specific certainty factor in [0, 1] (M3): dampens the
   * provenance-derived confidence when the detection *logic itself* is
   * heuristic even on trustworthy inputs (e.g. a fuzzy masquerading match).
   * Defaults to 1 (the rule adds no doubt of its own).
   */
  certaintyFactor?: Confidence;
  /** Rare per-finding severity bump; the rule default is used otherwise. */
  severityOverride?: Severity;
  explanation: string;
  verificationSteps: string[];
}

/** Everything a Rule may read while detecting. Read-only — detection is pure. */
export interface RuleContext {
  state: ProjectState;
  provenance: readonly FieldProvenance[];
  evidence: readonly Evidence[];
  /** This rule's resolved operator settings (thresholds, overrides). */
  settings: RuleSettings;
  /** The operator's allow/deny string lists (ADR-0024). */
  lists: IndicatorLists;
}

/**
 * A single versioned detection (ADR-0024). Detection logic is code; its knobs
 * are config. `detect` is pure: same context in, same drafts out.
 */
export interface Rule {
  id: string;
  ruleVersion: string;
  category: string;
  /** Severity is a property of the *kind* of problem, not of the data (M3). */
  defaultSeverity: Severity;
  /** Optional classification-framework mapping (design Q9); §3.8 is primary. */
  frameworkRefs?: readonly string[];
  detect(ctx: RuleContext): DetectionDraft[];
}

/**
 * The result of one analysis run: the derived detections plus the
 * Operation-log watermark they were computed against, so the UI can show
 * findings as "computed as of op #N" and flag staleness (ADR-0023).
 */
export const analysisRunSchema = z.object({
  /** The Operation-log `seq` this run analyzed — the staleness watermark. */
  opSeq: z.number().int(),
  configHash: z.string().min(1),
  detections: z.array(detectionRecordSchema),
});
export type AnalysisRun = z.infer<typeof analysisRunSchema>;
