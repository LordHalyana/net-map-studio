import type { Rule } from './rule.js';

/**
 * The built-in rule registry: the rules the analysis run executes. Real
 * detection rules (M5–M10) are appended here as each family lands. It is empty
 * in M1 — the spine is hardened with the fixture rule (not registered) before
 * any real rule is written, mirroring how Phase 2 built the observation
 * pipeline before real adapters.
 */
export const builtInRules: readonly Rule[] = [];
