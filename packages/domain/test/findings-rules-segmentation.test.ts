import { describe, expect, it } from 'vitest';
import {
  segmentationIdentityRules,
  engineConfigSchema,
  runAnalysis,
  type AnalysisContext,
  type ProjectState,
} from '../src/index.js';
import {
  makeDevice,
  makeFlow,
  makeHostInventory,
  makeIdentity,
  makeProject,
  makeRoleAssignment,
  makeService,
  makeSite,
  makeZone,
} from '../src/fixtures.js';

const project = makeProject();
const site = makeSite(project.id);
const zoneA = makeZone(site, { name: 'Corp' });
const zoneB = makeZone(site, { name: 'OT' });
const devA = makeDevice(project.id, { name: 'corp-pc', zoneId: zoneA.id });
const devB = makeDevice(project.id, { name: 'plc', zoneId: zoneB.id });

function baseState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    project,
    sites: [site],
    zones: [zoneA, zoneB],
    devices: [devA, devB],
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
    ...overrides,
  };
}

function run(state: ProjectState, hostInventories: AnalysisContext['hostInventories'] = []) {
  const ctx: AnalysisContext = {
    state,
    provenance: [],
    evidence: [],
    hostInventories,
    config: engineConfigSchema.parse({}),
    opSeq: 1,
  };
  return runAnalysis(segmentationIdentityRules, ctx).detections;
}

describe('M9 segmentation / identity / collection-quality (§3.8, §3.11)', () => {
  it('flags a cross-zone flow unsanctioned by policy (a Finding, not a RuleWarning)', () => {
    const flow = makeFlow(project.id, {
      source: { kind: 'device', id: devA.id },
      destination: { kind: 'device', id: devB.id },
    });
    const finding = run(baseState({ flows: [flow] })).find(
      (d) => d.category === 'unexpected cross-VLAN communication',
    );
    expect(finding).toBeDefined();
    expect(finding?.affected).toEqual({ kind: 'device', id: devA.id });
  });

  it('flags a service account holding admin on multiple hosts', () => {
    const svc = makeIdentity(project.id, { name: 'svc-backup', kind: 'serviceAccount' });
    const state = baseState({
      identities: [svc],
      roleAssignments: [
        makeRoleAssignment(svc, { deviceId: devA.id, privilege: 'localAdministrator' }),
        makeRoleAssignment(svc, { deviceId: devB.id, privilege: 'localAdministrator' }),
      ],
    });
    const finding = run(state).find((d) => d.category === 'privileged or service-account anomaly');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
    expect(finding?.affected).toBeNull();
  });

  it('does not flag a service account with admin on a single host', () => {
    const svc = makeIdentity(project.id, { name: 'svc-1', kind: 'serviceAccount' });
    const state = baseState({
      identities: [svc],
      roleAssignments: [
        makeRoleAssignment(svc, { deviceId: devA.id, privilege: 'localAdministrator' }),
      ],
    });
    expect(
      run(state).filter((d) => d.category === 'privileged or service-account anomaly'),
    ).toEqual([]);
  });

  it('emits a low-severity, high-confidence incomplete-collection finding naming un-evaluable families', () => {
    // devA has services (listeningServices) but no process/file inventory.
    const state = baseState({
      devices: [devA],
      zones: [zoneA],
      services: [makeService(project.id, { deviceId: devA.id })],
    });
    const finding = run(state).find(
      (d) => d.category === 'evidence conflict or incomplete collection',
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('low');
    expect(finding?.confidence).toBeCloseTo(0.9, 5);
    expect(finding?.explanation).toContain('filename / path');
    expect(finding?.explanation).toContain('process & persistence');
  });

  it('does not raise incomplete-collection for a fully-covered host', () => {
    const state = baseState({
      devices: [devA],
      zones: [zoneA],
      services: [makeService(project.id, { deviceId: devA.id })],
    });
    const inventory = makeHostInventory(devA.id, {
      files: [{ path: 'C:\\a.exe', sha256: null }],
      processes: [{ name: 'p.exe', path: null }],
    });
    expect(
      run(state, [inventory]).filter(
        (d) => d.category === 'evidence conflict or incomplete collection',
      ),
    ).toEqual([]);
  });
});
