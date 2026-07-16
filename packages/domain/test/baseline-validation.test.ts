import { describe, expect, it } from 'vitest';
import { validateBaselines, type ProjectState } from '../src/index.js';
import { makeBaseline, makeDevice, makeProject, makeSite, makeZone } from '../src/fixtures.js';

function stateWith(overrides: Partial<ProjectState>): ProjectState {
  const project = makeProject();
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
    ...overrides,
  };
}

describe('M4 baseline reference validation (ADR-0025, §3.11)', () => {
  it('does not warn when the baseline scope still exists', () => {
    const project = makeProject();
    const site = makeSite(project.id);
    const zone = makeZone(site);
    const baseline = makeBaseline(project.id, { kind: 'zone', id: zone.id });
    const warnings = validateBaselines(
      stateWith({ project, sites: [site], zones: [zone], baselines: [baseline] }),
    );
    expect(warnings).toEqual([]);
  });

  it('surfaces an orphaned reference when the scoped object is gone', () => {
    const project = makeProject();
    const device = makeDevice(project.id);
    // Baseline scoped to a device that is NOT present in state (deleted).
    const baseline = makeBaseline(project.id, { kind: 'device', id: device.id });
    const warnings = validateBaselines(stateWith({ project, baselines: [baseline] }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toBe('orphaned');
    expect(warnings[0]?.baselineId).toBe(baseline.id);
  });
});
