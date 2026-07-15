import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_CONFIG,
  engineConfigSchema,
  fixtureRule,
  FIXTURE_RULE_ID,
  runAnalysis,
  type AnalysisContext,
  type EngineConfig,
  type ProjectState,
} from '../src/index.js';
import {
  makeDevice,
  makeEvidence,
  makeFieldProvenance,
  makeImportJob,
  makeObservation,
  makeProject,
} from '../src/fixtures.js';

function buildContext(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  const project = makeProject();
  const device = makeDevice(project.id, { name: 'web01' });
  const job = makeImportJob(project.id);
  const evidence = makeEvidence(job);
  const observation = makeObservation(evidence);
  const provenance = makeFieldProvenance(observation, {
    entityType: 'device',
    entityId: device.id,
    field: 'name',
    confidence: 0.85,
  });
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
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
  };
  return {
    state,
    provenance: [provenance],
    evidence: [evidence],
    config: DEFAULT_ENGINE_CONFIG,
    opSeq: 7,
    ...overrides,
  };
}

describe('M1 rule-engine spine', () => {
  it('runs the fixture rule and emits one detection per device', () => {
    const ctx = buildContext();
    const run = runAnalysis([fixtureRule], ctx);
    expect(run.detections).toHaveLength(1);
    const [detection] = run.detections;
    expect(detection?.ruleId).toBe(FIXTURE_RULE_ID);
    expect(detection?.ruleVersion).toBe('1.0.0');
    expect(detection?.affected).toEqual({ kind: 'device', id: ctx.state.devices[0]?.id });
  });

  it('produces identical fingerprints for identical input', () => {
    const ctx = buildContext();
    const a = runAnalysis([fixtureRule], ctx);
    const b = runAnalysis([fixtureRule], ctx);
    expect(a.detections[0]?.fingerprint).toBe(b.detections[0]?.fingerprint);
  });

  it('produces a different fingerprint when the affected object changes', () => {
    const first = buildContext();
    const second = buildContext();
    const a = runAnalysis([fixtureRule], first);
    const b = runAnalysis([fixtureRule], second);
    // Different devices (different ids) → different fingerprints.
    expect(a.detections[0]?.fingerprint).not.toBe(b.detections[0]?.fingerprint);
  });

  it('records the operation-log watermark on the run', () => {
    const run = runAnalysis([fixtureRule], buildContext({ opSeq: 42 }));
    expect(run.opSeq).toBe(42);
  });

  it('stamps the config hash on every detection and changes it when config changes', () => {
    const baseCtx = buildContext();
    const baseRun = runAnalysis([fixtureRule], baseCtx);
    expect(baseRun.detections[0]?.configHash).toBe(baseRun.configHash);

    const tunedConfig: EngineConfig = engineConfigSchema.parse({
      rules: { [FIXTURE_RULE_ID]: { severityOverride: 'high' } },
    });
    const tunedRun = runAnalysis([fixtureRule], buildContext({ config: tunedConfig }));

    expect(tunedRun.configHash).not.toBe(baseRun.configHash);
    expect(tunedRun.detections[0]?.configHash).toBe(tunedRun.configHash);
    // The severity override takes effect (Severity is config-declared).
    expect(tunedRun.detections[0]?.severity).toBe('high');
    // …while the base run keeps the rule's declared default.
    expect(baseRun.detections[0]?.severity).toBe('low');
  });

  it('derives confidence from the contributing provenance rows', () => {
    const strong = runAnalysis([fixtureRule], buildContext());
    // A single 0.85 provenance row → confidence 0.85.
    expect(strong.detections[0]?.confidence).toBeCloseTo(0.85, 5);
  });

  it('is a pure recomputation: it never mutates the input state', () => {
    const ctx = buildContext();
    const snapshot = JSON.stringify(ctx.state);
    runAnalysis([fixtureRule], ctx);
    expect(JSON.stringify(ctx.state)).toBe(snapshot);
  });

  it('skips rules disabled by config', () => {
    const config = engineConfigSchema.parse({
      rules: { [FIXTURE_RULE_ID]: { enabled: false } },
    });
    const run = runAnalysis([fixtureRule], buildContext({ config }));
    expect(run.detections).toHaveLength(0);
  });

  it('emits detection records that carry no operation — detection never touches the log', () => {
    const run = runAnalysis([fixtureRule], buildContext());
    for (const detection of run.detections) {
      expect(detection).not.toHaveProperty('kind');
      expect(detection).not.toHaveProperty('operations');
      expect(detection).toHaveProperty('fingerprint');
    }
  });
});
