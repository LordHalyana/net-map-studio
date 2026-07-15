import type { Rule } from './rule.js';
import { filenamePathRules } from './rules/filename-path.js';
import { processPersistenceRules } from './rules/process-persistence.js';

/**
 * The built-in rule registry: the rules the analysis run executes. Real
 * detection rules (M5–M10) are appended here as each family lands. The fixture
 * rule (used to harden the spine) is intentionally NOT registered.
 */
export const builtInRules: readonly Rule[] = [...filenamePathRules, ...processPersistenceRules];
