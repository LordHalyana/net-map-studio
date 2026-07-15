import { z } from 'zod';
import { severitySchema } from '../seams.js';
import { hashString, stableStringify } from './hash.js';

/**
 * The hybrid rule engine (ADR-0024): detection *logic* is typed TypeScript,
 * but its *knobs* — thresholds, per-rule severity overrides, enable/disable,
 * and operator-maintained allow/deny string lists — are versioned data,
 * validated by Zod (ADR-0017). Every Finding stamps the config's hash so it is
 * reproducible against the exact tuning that produced it.
 */

/** Per-rule operator settings, keyed by ruleId in `EngineConfig.rules`. */
export const ruleSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Overrides the rule's declared `defaultSeverity` (Severity ⟂ Confidence). */
  severityOverride: severitySchema.optional(),
  /** Rule-specific thresholds (e.g. beacon period tolerance). Read by the rule. */
  params: z.record(z.string(), z.json()).default({}),
});
export type RuleSettings = z.infer<typeof ruleSettingsSchema>;

export const DEFAULT_RULE_SETTINGS: RuleSettings = ruleSettingsSchema.parse({});

/**
 * Operator-maintained allow/deny lists of opaque strings (ADR-0024). These are
 * Rule *config*, not model objects — unlike a Baseline, which references real
 * entities by id (ADR-0025). Rule families read the lists they care about.
 */
export const indicatorListsSchema = z.object({
  /** Filenames or path fragments that are inherently suspicious (M5). */
  suspiciousFilenames: z.array(z.string()).default([]),
  suspiciousPathSegments: z.array(z.string()).default([]),
  /** Locations executables are not expected to run from (M5). */
  unexpectedExecutablePaths: z.array(z.string()).default([]),
  /** Known-bad file hashes — the local IoC list, no egress (M5). */
  knownFileHashes: z.array(z.string()).default([]),
  /** Software approved to be installed; anything else is flagged (M6). */
  approvedSoftware: z.array(z.string()).default([]),
  /** Known-bad external destinations — the local IoC list (M8/M10). */
  indicatorDestinations: z.array(z.string()).default([]),
});
export type IndicatorLists = z.infer<typeof indicatorListsSchema>;

export const DEFAULT_INDICATOR_LISTS: IndicatorLists = indicatorListsSchema.parse({});

export const engineConfigSchema = z.object({
  /** Bumped by the operator; part of the reproducibility record. */
  version: z.string().default('1'),
  rules: z.record(z.string(), ruleSettingsSchema).default({}),
  lists: indicatorListsSchema.default(DEFAULT_INDICATOR_LISTS),
});
export type EngineConfig = z.infer<typeof engineConfigSchema>;

export const DEFAULT_ENGINE_CONFIG: EngineConfig = engineConfigSchema.parse({});

/** Resolve a rule's settings, falling back to defaults when unconfigured. */
export function resolveRuleSettings(config: EngineConfig, ruleId: string): RuleSettings {
  return config.rules[ruleId] ?? DEFAULT_RULE_SETTINGS;
}

/**
 * A stable content hash of the whole config. Changes whenever any threshold,
 * override, enable flag or list entry changes; stamped on every detection so a
 * Finding can be reproduced against the exact config that produced it.
 */
export function hashConfig(config: EngineConfig): string {
  return hashString(stableStringify(config));
}
