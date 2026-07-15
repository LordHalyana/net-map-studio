import { describe, expect, it } from 'vitest';
import {
  externalConnectionRules,
  engineConfigSchema,
  runAnalysis,
  type AnalysisContext,
  type Flow,
  type ProjectState,
} from '../src/index.js';
import { makeBaseline, makeDevice, makeFlow, makeProject } from '../src/fixtures.js';

const project = makeProject();
const device = makeDevice(project.id, { name: 'ws-01' });

function state(flows: Flow[], baselines: ProjectState['baselines'] = []): ProjectState {
  return {
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
    flows,
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines,
  };
}

function run(flows: Flow[], baselines: ProjectState['baselines'] = []) {
  const ctx: AnalysisContext = {
    state: state(flows, baselines),
    provenance: [],
    evidence: [],
    config: engineConfigSchema.parse({}),
    opSeq: 1,
  };
  return runAnalysis(externalConnectionRules, ctx).detections;
}

describe('M8 external-connection family (§3.8)', () => {
  it('flags an external destination outside the expected-traffic Baseline', () => {
    const baseline = makeBaseline(
      project.id,
      { kind: 'device', id: device.id },
      { expectedTraffic: [{ destination: 'updates.example.com', description: 'patching' }] },
    );
    const flow = makeFlow(project.id, {
      source: { kind: 'device', id: device.id },
      destination: { kind: 'external', value: '198.51.100.7' },
    });
    const finding = run([flow], [baseline]).find(
      (d) => d.category === 'unexpected external destination',
    );
    expect(finding).toBeDefined();
    expect(finding?.affected).toEqual({ kind: 'device', id: device.id });
    expect(finding?.explanation).toContain('198.51.100.7');
  });

  it('does not flag a destination that the Baseline expects (domain suffix match)', () => {
    const baseline = makeBaseline(
      project.id,
      { kind: 'device', id: device.id },
      { expectedTraffic: [{ destination: '.example.com', description: 'vendor' }] },
    );
    const flow = makeFlow(project.id, {
      source: { kind: 'device', id: device.id },
      destination: { kind: 'external', value: 'cdn.example.com' },
    });
    expect(
      run([flow], [baseline]).filter((d) => d.category === 'unexpected external destination'),
    ).toEqual([]);
  });

  it('flags a beacon-like periodic flow crossing the threshold', () => {
    const flow = makeFlow(project.id, {
      source: { kind: 'device', id: device.id },
      destination: { kind: 'external', value: '203.0.113.9' },
      firstSeen: '2026-07-14T00:00:00.000Z',
      lastSeen: '2026-07-14T06:00:00.000Z', // 6h span
      observationCount: 60, // ~ every 6 min
    });
    const finding = run([flow]).find((d) => d.category === 'beacon-like periodic communication');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
    // Heuristic confidence is dampened below the flow's own confidence.
    expect(finding?.confidence).toBeLessThan(flow.confidence);
  });

  it('does not flag a sub-threshold flow as a beacon', () => {
    const flow = makeFlow(project.id, {
      source: { kind: 'device', id: device.id },
      destination: { kind: 'external', value: '203.0.113.9' },
      firstSeen: '2026-07-14T00:00:00.000Z',
      lastSeen: '2026-07-14T06:00:00.000Z',
      observationCount: 3, // too few
    });
    expect(run([flow]).filter((d) => d.category === 'beacon-like periodic communication')).toEqual(
      [],
    );
  });

  it('handles a flow endpoint with no known Device without fabricating one', () => {
    // Both endpoints external: no internal scope, so no unexpected-destination finding,
    // and the beacon finding (if any) has a null affected — no Device is invented.
    const flow = makeFlow(project.id, {
      source: { kind: 'external', value: '10.9.9.9' },
      destination: { kind: 'external', value: '203.0.113.9' },
      firstSeen: '2026-07-14T00:00:00.000Z',
      lastSeen: '2026-07-14T06:00:00.000Z',
      observationCount: 60,
    });
    const detections = run([flow]);
    expect(detections.filter((d) => d.category === 'unexpected external destination')).toEqual([]);
    const beacon = detections.find((d) => d.category === 'beacon-like periodic communication');
    expect(beacon?.affected).toBeNull();
  });
});
