import type { Rule } from './rule.js';

/**
 * A canned rule with no real detection logic (mirrors the Phase-2 fixture
 * adapter). It emits one detection per Device, referencing whatever evidence
 * and provenance the context carries, so the rule-engine spine — fingerprint
 * stability, config-hash stamping, provenance-derived confidence, and the
 * derived/persisted split — can be hardened before any real rule exists.
 *
 * Not part of the built-in rule registry: it is a test/spine fixture.
 */
export const FIXTURE_RULE_ID = 'fixture.canned';

export const fixtureRule: Rule = {
  id: FIXTURE_RULE_ID,
  ruleVersion: '1.0.0',
  category: 'fixture',
  defaultSeverity: 'low',
  detect(ctx) {
    return ctx.state.devices.map((device) => {
      const provenanceRows = ctx.provenance.filter(
        (row) => row.entityType === 'device' && row.entityId === device.id,
      );
      return {
        affected: { kind: 'device', id: device.id } as const,
        salientKey: `fixture:${device.id}`,
        title: `Fixture finding for ${device.name}`,
        evidenceRefs: ctx.evidence.map((e) => e.id),
        contributingProvenanceRows: provenanceRows.map((row) => row.id),
        explanation: 'Canned finding emitted by the fixture rule to exercise the engine spine.',
        verificationSteps: ['This is a fixture — no verification is required.'],
      };
    });
  },
};
