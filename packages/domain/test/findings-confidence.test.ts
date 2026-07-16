import { describe, expect, it } from 'vitest';
import {
  contributorScore,
  deriveConfidence,
  engineConfigSchema,
  runAnalysis,
  type AnalysisContext,
  type DetectionDraft,
  type FieldProvenance,
  type ProjectState,
  type Rule,
} from '../src/index.js';
import {
  makeDevice,
  makeEvidence,
  makeFieldProvenance,
  makeImportJob,
  makeObservation,
  makeProject,
} from '../src/fixtures.js';

const project = makeProject();
const device = makeDevice(project.id, { name: 'web01' });
const job = makeImportJob(project.id);
const evidence = makeEvidence(job);
const observation = makeObservation(evidence);

/** Two corroborating provenance rows on the same field vs. a single OS guess. */
const macRow = makeFieldProvenance(observation, {
  entityType: 'device',
  entityId: device.id,
  field: 'name',
  confidence: contributorScore('exactMacMatch'),
});
const stableRow = makeFieldProvenance(observation, {
  entityType: 'device',
  entityId: device.id,
  field: 'name',
  confidence: contributorScore('stableDeviceId'),
});
const osGuessRow = makeFieldProvenance(observation, {
  entityType: 'device',
  entityId: device.id,
  field: 'os',
  confidence: contributorScore('osFingerprint'),
});

function draft(rows: FieldProvenance[], extra: Partial<DetectionDraft> = {}): DetectionDraft {
  return {
    affected: { kind: 'device', id: device.id },
    salientKey: 'k',
    title: 't',
    evidenceRefs: [],
    contributingProvenanceRows: rows.map((r) => r.id),
    explanation: 'e',
    verificationSteps: [],
    ...extra,
  };
}

const allProvenance = [macRow, stableRow, osGuessRow];

describe('M3 confidence from provenance (ADR-0023)', () => {
  it('scores a two-source, exact-MAC finding higher than a single OS guess', () => {
    const corroborated = deriveConfidence(draft([macRow, stableRow]), allProvenance);
    const single = deriveConfidence(draft([osGuessRow]), allProvenance);
    expect(corroborated).toBeGreaterThan(single);
  });

  it('changes when an underlying provenance row confidence changes', () => {
    const before = deriveConfidence(draft([macRow]), allProvenance);
    const weakened = { ...macRow, confidence: 0.2 };
    const after = deriveConfidence(draft([macRow]), [weakened, stableRow, osGuessRow]);
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(0.2, 5);
  });

  it('dampens confidence by the rule-specific certainty factor', () => {
    const full = deriveConfidence(draft([macRow]), allProvenance);
    const damped = deriveConfidence(draft([macRow], { certaintyFactor: 0.5 }), allProvenance);
    expect(damped).toBeCloseTo(full * 0.5, 5);
  });

  it('falls back to baseConfidence when no provenance rows are named', () => {
    expect(deriveConfidence(draft([], { baseConfidence: 0.3 }), allProvenance)).toBeCloseTo(0.3, 5);
    expect(deriveConfidence(draft([]), allProvenance)).toBe(0);
  });
});

describe('M3 severity is rule-declared and independent of confidence', () => {
  const state: ProjectState = {
    project,
    sites: [],
    zones: [],
    devices: [device],
    interfaces: [],
    addresses: [],
    networks: [],
    links: [],
    services: [],
    policyRules: [],
    flows: [],
    hostArtifacts: [],
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
  };

  const rule: Rule = {
    id: 'test.sev',
    ruleVersion: '1.0.0',
    category: 'test',
    defaultSeverity: 'high',
    detect: () => [draft([osGuessRow])],
  };

  function run(ctx: Partial<AnalysisContext> = {}) {
    return runAnalysis([rule], {
      state,
      provenance: allProvenance,
      evidence: [],
      config: engineConfigSchema.parse({}),
      opSeq: 1,
      ...ctx,
    });
  }

  it('keeps the rule-declared severity regardless of the data-derived confidence', () => {
    const detection = run().detections[0];
    expect(detection?.severity).toBe('high');
    // Confidence is low (single OS guess) but severity is unaffected — orthogonal.
    expect(detection?.confidence).toBeLessThan(0.5);
  });

  it('applies a config severity override without touching confidence', () => {
    const config = engineConfigSchema.parse({ rules: { 'test.sev': { severityOverride: 'low' } } });
    const overridden = run({ config }).detections[0];
    const base = run().detections[0];
    expect(overridden?.severity).toBe('low');
    // Same data → same confidence; only severity moved.
    expect(overridden?.confidence).toBeCloseTo(base?.confidence ?? -1, 10);
  });
});
