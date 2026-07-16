import { describe, expect, it } from 'vitest';
import {
  computeDeviceCoverage,
  DEFAULT_ENGINE_CONFIG,
  fixtureRule,
  reconcileFindings,
  runAnalysis,
  type AnalysisContext,
  type FindingDisposition,
  type ProjectState,
} from '../src/index.js';
import {
  makeDevice,
  makeFindingDisposition,
  makeFlow,
  makeIdentity,
  makeProject,
  makeRoleAssignment,
  makeService,
} from '../src/fixtures.js';

function emptyState(project = makeProject()): ProjectState {
  return {
    project,
    sites: [],
    zones: [],
    devices: [],
    interfaces: [],
    addresses: [],
    networks: [],
    links: [],
    services: [],
    policyRules: [],
    flows: [],
    hostArtifacts: [],
    reports: [],
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
  };
}

function runForState(state: ProjectState, overrides: Partial<AnalysisContext> = {}) {
  const ctx: AnalysisContext = {
    state,
    provenance: [],
    evidence: [],
    config: DEFAULT_ENGINE_CONFIG,
    opSeq: 1,
    ...overrides,
  };
  return runAnalysis([fixtureRule], ctx);
}

describe('M2 reconciliation (ADR-0023)', () => {
  it('a brand-new detection with no disposition starts at `new`', () => {
    const project = makeProject();
    const state = { ...emptyState(project), devices: [makeDevice(project.id)] };
    const run = runForState(state);
    const views = reconcileFindings(run.detections, []);
    expect(views).toHaveLength(1);
    expect(views[0]?.status).toBe('new');
    expect(views[0]?.stale).toBe(false);
    expect(views[0]?.dispositionId).toBeNull();
  });

  it('an unchanged fingerprint keeps its disposition across a re-run', () => {
    const project = makeProject();
    const device = makeDevice(project.id);
    const state = { ...emptyState(project), devices: [device] };

    const firstRun = runForState(state);
    const fingerprint = firstRun.detections[0]?.fingerprint;
    expect(fingerprint).toBeDefined();

    const disposition: FindingDisposition = makeFindingDisposition(project.id, {
      fingerprint: fingerprint!,
      status: 'falsePositive',
      notes: 'benign scanner',
    });

    // Re-run analysis on the same graph — the fingerprint is identical.
    const secondRun = runForState(state);
    const views = reconcileFindings(secondRun.detections, [disposition]);

    expect(views).toHaveLength(1);
    expect(views[0]?.status).toBe('falsePositive');
    expect(views[0]?.notes).toBe('benign scanner');
    expect(views[0]?.stale).toBe(false);
  });

  it('a disposition whose detection disappears is retained and marked stale', () => {
    const project = makeProject();
    const orphan = makeFindingDisposition(project.id, {
      fingerprint: 'gone-fingerprint',
      status: 'acceptedRisk',
    });
    // No detections this run.
    const views = reconcileFindings([], [orphan]);
    expect(views).toHaveLength(1);
    expect(views[0]?.stale).toBe(true);
    expect(views[0]?.status).toBe('acceptedRisk');
    expect(views[0]?.detection).toBeNull();
  });

  it('surfaces both active and stale findings together', () => {
    const project = makeProject();
    const device = makeDevice(project.id);
    const state = { ...emptyState(project), devices: [device] };
    const run = runForState(state);
    const active = run.detections[0]?.fingerprint;

    const stale = makeFindingDisposition(project.id, {
      fingerprint: 'stale-one',
      status: 'resolved',
    });
    const activeDisp = makeFindingDisposition(project.id, {
      fingerprint: active!,
      status: 'acknowledged',
    });

    const views = reconcileFindings(run.detections, [activeDisp, stale]);
    expect(views).toHaveLength(2);
    expect(views.find((v) => v.fingerprint === active)?.stale).toBe(false);
    expect(views.find((v) => v.fingerprint === 'stale-one')?.stale).toBe(true);
  });
});

describe('M2 coverage tracking', () => {
  it('reports available input classes per device from the committed graph', () => {
    const project = makeProject();
    const covered = makeDevice(project.id, { name: 'covered' });
    const bare = makeDevice(project.id, { name: 'bare' });
    const identity = makeIdentity(project.id, { deviceId: covered.id });
    const state: ProjectState = {
      ...emptyState(project),
      devices: [covered, bare],
      services: [makeService(project.id, { deviceId: covered.id })],
      identities: [identity],
      roleAssignments: [makeRoleAssignment(identity, { deviceId: covered.id })],
      flows: [makeFlow(project.id, { source: { kind: 'device', id: covered.id } })],
    };

    const coverage = computeDeviceCoverage(state);
    const coveredCov = coverage.find((c) => c.deviceId === covered.id);
    const bareCov = coverage.find((c) => c.deviceId === bare.id);

    expect(coveredCov?.available).toEqual(
      expect.arrayContaining(['listeningServices', 'identities', 'roleAssignments', 'flows']),
    );
    // A host imported without process data does not read as a false clean:
    // those classes are reported missing, not silently passed.
    expect(bareCov?.available).toEqual([]);
    expect(bareCov?.missing).toContain('processes');
    expect(bareCov?.missing).toContain('listeningServices');
  });
});
