import { describe, expect, it } from 'vitest';
import {
  exposedServiceRules,
  engineConfigSchema,
  runAnalysis,
  type AnalysisContext,
  type Baseline,
  type ProjectState,
  type Service,
} from '../src/index.js';
import {
  makeBaseline,
  makeDevice,
  makeProject,
  makeService,
  makeSite,
  makeZone,
} from '../src/fixtures.js';

const project = makeProject();
const site = makeSite(project.id);
const zone = makeZone(site);
const device = makeDevice(project.id, { name: 'srv-01', zoneId: zone.id });

function state(services: Service[], baselines: Baseline[]): ProjectState {
  return {
    project,
    sites: [site],
    zones: [zone],
    devices: [device],
    interfaces: [],
    addresses: [],
    networks: [],
    links: [],
    services,
    policyRules: [],
    flows: [],
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines,
  };
}

function run(services: Service[], baselines: Baseline[]) {
  const ctx: AnalysisContext = {
    state: state(services, baselines),
    provenance: [],
    evidence: [],
    config: engineConfigSchema.parse({}),
    opSeq: 1,
  };
  return runAnalysis(exposedServiceRules, ctx).detections;
}

const rdp = () =>
  makeService(project.id, { deviceId: device.id, name: 'RDP', protocol: 'tcp', portStart: 3389 });

describe('M7 exposed-service family (§3.8, ADR-0025)', () => {
  it('flags a management service absent from the zone Baseline, citing the Baseline', () => {
    const baseline = makeBaseline(
      project.id,
      { kind: 'zone', id: zone.id },
      { name: 'Zone services', version: 3, expectedServices: [] },
    );
    const detections = run([rdp()], [baseline]);
    const finding = detections.find((d) => d.category === 'high-risk exposed management service');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
    expect(finding?.explanation).toContain('Zone services');
    expect(finding?.explanation).toContain('v3');
  });

  it('does not flag a management service that the Baseline expects', () => {
    const baseline = makeBaseline(
      project.id,
      { kind: 'zone', id: zone.id },
      { expectedServices: [{ protocol: 'tcp', port: 3389, description: 'jump host' }] },
    );
    const detections = run([rdp()], [baseline]);
    expect(detections.filter((d) => d.category === 'high-risk exposed management service')).toEqual(
      [],
    );
  });

  it('flags a clear-text / obsolete protocol at the rule-declared severity', () => {
    const telnet = makeService(project.id, {
      deviceId: device.id,
      name: 'Telnet',
      protocol: 'tcp',
      portStart: 23,
    });
    const detections = run([telnet], []);
    const finding = detections.find((d) => d.category === 'clear-text or obsolete protocol');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('medium');
  });

  it('does not flag an ordinary service', () => {
    const https = makeService(project.id, {
      deviceId: device.id,
      name: 'HTTPS',
      protocol: 'tcp',
      portStart: 443,
    });
    expect(run([https], [])).toEqual([]);
  });
});
