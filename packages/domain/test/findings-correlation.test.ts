import { describe, expect, it } from 'vitest';
import {
  builtInCorrelationRules,
  builtInRules,
  engineConfigSchema,
  reconcileFindings,
  runAnalysis,
  runBuiltInAnalysis,
  type AnalysisContext,
  type DeviceId,
  type EngineConfig,
  type Flow,
  type ProjectState,
} from '../src/index.js';
import { makeDevice, makeFlow, makeProject } from '../src/fixtures.js';

const project = makeProject();
const iocDest = '203.0.113.66';

function flowTo(deviceId: DeviceId): Flow {
  return makeFlow(project.id, {
    source: { kind: 'device', id: deviceId },
    destination: { kind: 'external', value: iocDest },
  });
}

function stateWith(deviceCount: number): { state: ProjectState; ids: string[] } {
  const devices = Array.from({ length: deviceCount }, (_, i) =>
    makeDevice(project.id, { name: `host-${i}` }),
  );
  const flows = devices.map((d) => flowTo(d.id));
  const state: ProjectState = {
    project,
    sites: [],
    zones: [],
    devices,
    interfaces: [],
    addresses: [],
    networks: [],
    links: [],
    services: [],
    policyRules: [],
    flows,
    hostArtifacts: [],
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
  };
  return { state, ids: devices.map((d) => d.id) };
}

function run(state: ProjectState, config: EngineConfig) {
  const ctx: AnalysisContext = {
    state,
    provenance: [],
    evidence: [],
    config,
    opSeq: 1,
  };
  return runAnalysis(builtInRules, ctx, builtInCorrelationRules).detections;
}

const configWithIoc = engineConfigSchema.parse({ lists: { indicatorDestinations: [iocDest] } });

describe('M10 network-wide correlation capstone (§3.8)', () => {
  it('raises one network-wide finding when an IoC destination is hit by three unrelated hosts', () => {
    const { state } = stateWith(3);
    const network = run(state, configWithIoc).filter(
      (d) => d.category === 'network-wide compromise assessment',
    );
    expect(network).toHaveLength(1);
    expect(network[0]?.affected).toBeNull(); // network scope
    expect(network[0]?.explanation).toContain('Correlation logic');
    expect(network[0]?.explanation.toLowerCase()).toContain('may be compromised');
    // Never asserts a confirmed compromise (it may explicitly say it is NOT confirmed).
    expect(network[0]?.explanation.toLowerCase()).not.toContain('confirmed compromise');
    expect(network[0]?.explanation.toLowerCase()).not.toContain('is compromised');
  });

  it('does not raise a network-wide finding for a single-host indicator', () => {
    const { state } = stateWith(1);
    const network = run(state, configWithIoc).filter(
      (d) => d.category === 'network-wide compromise assessment',
    );
    expect(network).toEqual([]);
  });

  it('the network-wide finding is an ordinary Finding: fingerprint + dispositionable', () => {
    const { state } = stateWith(3);
    const detections = run(state, configWithIoc);
    const network = detections.find((d) => d.category === 'network-wide compromise assessment');
    expect(network?.fingerprint).toBeTruthy();
    // It joins the disposition workflow like any other finding.
    const views = reconcileFindings([network!], []);
    expect(views[0]?.status).toBe('new');
  });

  it('runBuiltInAnalysis runs both passes', () => {
    const { state } = stateWith(3);
    const ctx: AnalysisContext = {
      state,
      provenance: [],
      evidence: [],
      config: configWithIoc,
      opSeq: 5,
    };
    const runResult = runBuiltInAnalysis(ctx);
    expect(runResult.opSeq).toBe(5);
    expect(
      runResult.detections.some((d) => d.category === 'network-wide compromise assessment'),
    ).toBe(true);
  });

  it('produces a stable fingerprint across identical runs (disposition survives re-analysis)', () => {
    const { state } = stateWith(3);
    const a = run(state, configWithIoc).find(
      (d) => d.category === 'network-wide compromise assessment',
    );
    const b = run(state, configWithIoc).find(
      (d) => d.category === 'network-wide compromise assessment',
    );
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });
});
