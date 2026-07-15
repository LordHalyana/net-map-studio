import { runAnalysis, type AnalysisContext } from './engine.js';
import type { AnalysisRun, CorrelationRule, Rule } from './rule.js';
import { correlationRules } from './correlation.js';
import { enrichmentRules } from './rules/enrichment.js';
import { filenamePathRules } from './rules/filename-path.js';
import { processPersistenceRules } from './rules/process-persistence.js';
import { exposedServiceRules } from './rules/exposed-service.js';
import { externalConnectionRules } from './rules/external-connection.js';
import { segmentationIdentityRules } from './rules/segmentation-identity.js';

/**
 * The built-in per-object rule registry (first pass). The fixture rule (used to
 * harden the spine) is intentionally NOT registered.
 */
export const builtInRules: readonly Rule[] = [
  ...filenamePathRules,
  ...processPersistenceRules,
  ...exposedServiceRules,
  ...externalConnectionRules,
  ...segmentationIdentityRules,
  ...enrichmentRules,
];

/** The built-in correlation registry (second pass, M10). */
export const builtInCorrelationRules: readonly CorrelationRule[] = [...correlationRules];

/** Run the full built-in two-pass analysis (per-object detection, then correlation). */
export function runBuiltInAnalysis(ctx: AnalysisContext): AnalysisRun {
  return runAnalysis(builtInRules, ctx, builtInCorrelationRules);
}
