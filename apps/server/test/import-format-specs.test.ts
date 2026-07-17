import { describe, expect, it } from 'vitest';
import {
  IMPORT_FORMAT_SPECS,
  importProfileIdSchema,
  newId,
  projectIdSchema,
} from '@netplan/domain';
import { builtInAdapters } from '../src/imports/adapters/registry.js';
import { DEFAULT_PARSE_LIMITS, startBudget } from '../src/imports/guards.js';

/**
 * #90 A0: the guard that keeps the in-app format docs honest. Every
 * descriptor's `example` must parse through the REAL adapter into at least
 * one observation — if an adapter's expectations change, the stale example
 * breaks here, in CI, instead of in front of a user.
 */

function ctx() {
  return { budget: startBudget(DEFAULT_PARSE_LIMITS), limits: DEFAULT_PARSE_LIMITS };
}

describe('import format descriptors ↔ adapter registry', () => {
  it('every non-fixture adapter has a descriptor, and every descriptor an adapter', () => {
    const adapterNames = [...builtInAdapters.keys()].filter((name) => name !== 'fixture').sort();
    expect(Object.keys(IMPORT_FORMAT_SPECS).sort()).toEqual(adapterNames);
  });

  for (const spec of Object.values(IMPORT_FORMAT_SPECS)) {
    it(`the ${spec.adapter} example round-trips through its adapter`, async () => {
      const adapter = builtInAdapters.get(spec.adapter);
      expect(adapter).toBeDefined();
      const profile = spec.exampleProfilePattern
        ? {
            id: newId(importProfileIdSchema),
            projectId: newId(projectIdSchema),
            name: 'descriptor example',
            adapter: spec.adapter,
            pattern: spec.exampleProfilePattern,
            description: '',
          }
        : undefined;
      const drafts = await adapter?.parse(spec.example, { ...ctx(), profile });
      expect(drafts?.length).toBeGreaterThanOrEqual(1);
    });
  }
});
