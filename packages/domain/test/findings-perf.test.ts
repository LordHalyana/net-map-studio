import { describe, expect, it } from 'vitest';
import {
  engineConfigSchema,
  runBuiltInAnalysis,
  validatePolicyRules,
  type Flow,
  type Interface,
  type PolicyRule,
  type ProjectState,
} from '../src/index.js';
import {
  makeDevice,
  makeFlow,
  makeInterface,
  makeNetwork,
  makePolicyRule,
  makeProject,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';

/**
 * #110 B2: coarse wall-clock canary at ADR-0019's 5k-Flow scale target.
 * Before the per-run resolution index, cross-zone detection was
 * flows × rules × full-interface rescans; this guards against reintroducing
 * that shape. The bound is deliberately generous — it exists to catch a
 * complexity-class regression, not timing noise.
 */

const FLOW_COUNT = 5_000;
const DEVICE_COUNT = 120;
const RULE_COUNT = 60;
const GENEROUS_WALL_CLOCK_MS = 10_000;

function scaledState(): ProjectState {
  const project = makeProject();
  const site = makeSite(project.id);
  const zones = Array.from({ length: 6 }, (_, i) => makeZone(site, { name: `zone-${i}` }));
  const networks = Array.from({ length: 12 }, (_, i) =>
    makeNetwork(project.id, { name: `vlan-${i}` }),
  );
  const devices = Array.from({ length: DEVICE_COUNT }, (_, i) =>
    makeDevice(project.id, { name: `dev-${i}`, zoneId: zones[i % zones.length]?.id ?? null }),
  );
  const interfaces: Interface[] = devices.map((device, i) =>
    makeInterface(device, { networkId: networks[i % networks.length]?.id ?? null }),
  );
  // Sanction a minority of pairs so most cross-zone flows emit findings.
  const policyRules: PolicyRule[] = Array.from({ length: RULE_COUNT }, (_, i) => {
    const src = networks[i % networks.length];
    const dst = networks[(i + 1) % networks.length];
    if (!src || !dst) throw new Error('network fixture missing');
    return makePolicyRule(src, dst, {
      action: i % 3 === 0 ? 'allow' : 'monitor',
      direction: i % 2 === 0 ? 'bidirectional' : 'inbound',
    });
  });
  const flows: Flow[] = Array.from({ length: FLOW_COUNT }, (_, i) => {
    const src = devices[i % devices.length];
    const dst = devices[(i * 7 + 3) % devices.length];
    if (!src || !dst) throw new Error('device fixture missing');
    return makeFlow(project.id, {
      source: { kind: 'device', id: src.id },
      destination: { kind: 'device', id: dst.id },
      protocol: 'tcp',
      port: 1000 + (i % 400),
    });
  });

  return {
    project,
    sites: [site],
    zones,
    devices,
    interfaces,
    addresses: [],
    networks,
    links: [],
    services: [],
    policyRules,
    flows,
    hostArtifacts: [],
    reports: [],
    importProfiles: [],
    secretMatches: [],
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
  };
}

describe('findings engine at the 5k-flow scale target (ADR-0019)', () => {
  it('completes a full built-in analysis within a generous wall-clock bound', () => {
    const state = scaledState();
    const started = Date.now();
    const run = runBuiltInAnalysis({
      state,
      provenance: [],
      evidence: [],
      config: engineConfigSchema.parse({}),
      opSeq: 1,
    });
    const elapsed = Date.now() - started;
    // Sanity: the scene actually exercises the cross-zone hot loop.
    expect(run.detections.length).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(GENEROUS_WALL_CLOCK_MS);
  });

  it('validates policy rules against 5k flows within the same bound', () => {
    const state = scaledState();
    const started = Date.now();
    const warnings = validatePolicyRules(state);
    const elapsed = Date.now() - started;
    expect(warnings.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(GENEROUS_WALL_CLOCK_MS);
  });
});
