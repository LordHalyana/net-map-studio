import { describe, expect, it } from 'vitest';
import {
  ruleMatchesFlow,
  validatePolicyRules,
  type Flow,
  type PolicyRule,
  type ProjectState,
  type Service,
} from '../src/index.js';
import {
  makeDevice,
  makeFlow,
  makeInterface,
  makeNetwork,
  makePolicyRule,
  makeProject,
  makeService,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';

const project = makeProject();
const staff = makeNetwork(project.id, { name: 'Staff-VLAN', vlanId: 10 });
const servers = makeNetwork(project.id, { name: 'Servers-VLAN', vlanId: 20 });
const anyNet = makeNetwork(project.id, {
  name: 'any',
  kind: 'subnet',
  vlanId: null,
  cidr: '0.0.0.0/0',
});
const https = makeService(project.id);

function stateWith(rules: PolicyRule[], services: Service[] = [https]): ProjectState {
  return {
    project,
    sites: [],
    zones: [],
    devices: [],
    interfaces: [],
    addresses: [],
    networks: [staff, servers, anyNet],
    links: [],
    services,
    policyRules: rules,
    flows: [],
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

describe('validatePolicyRules (§3.11 starter set)', () => {
  it('accepts a clean allow + default-deny pair', () => {
    const allow = makePolicyRule(staff, servers, { serviceId: https.id, action: 'allow' });
    const defaultDeny = makePolicyRule(anyNet, anyNet, { action: 'deny' });
    expect(validatePolicyRules(stateWith([allow, defaultDeny]))).toEqual([]);
  });

  it('flags a permissive any-to-any rule', () => {
    const anyToAny = makePolicyRule(anyNet, anyNet, { action: 'allow' });
    const warnings = validatePolicyRules(stateWith([anyToAny]));
    expect(warnings.some((w) => w.category === 'anyToAny' && w.ruleId === anyToAny.id)).toBe(true);
  });

  it('does not flag a default deny as any-to-any', () => {
    const defaultDeny = makePolicyRule(anyNet, anyNet, { action: 'deny' });
    expect(validatePolicyRules(stateWith([defaultDeny]))).toEqual([]);
  });

  it('flags rules referencing deleted objects as orphaned', () => {
    const ghost = makeNetwork(project.id, { name: 'ghost' });
    const rule = makePolicyRule(staff, ghost, { action: 'allow' });
    const withMissingService = makePolicyRule(staff, servers, {
      action: 'allow',
      serviceId: https.id,
    });
    const warnings = validatePolicyRules(stateWith([rule, withMissingService], []));
    expect(warnings.filter((w) => w.category === 'orphaned').map((w) => w.ruleId)).toEqual(
      expect.arrayContaining([rule.id, withMissingService.id]),
    );
  });

  it('flags contradictory rules on the same traffic', () => {
    const allow = makePolicyRule(staff, servers, { serviceId: https.id, action: 'allow' });
    const deny = makePolicyRule(staff, servers, { serviceId: https.id, action: 'deny' });
    const warnings = validatePolicyRules(stateWith([allow, deny]));
    expect(warnings.filter((w) => w.category === 'contradictory')).toHaveLength(2);
  });

  it('flags a specific rule shadowed by a broader opposite rule', () => {
    const broadDeny = makePolicyRule(staff, servers, { action: 'deny' }); // any service
    const specificAllow = makePolicyRule(staff, servers, { serviceId: https.id, action: 'allow' });
    const warnings = validatePolicyRules(stateWith([broadDeny, specificAllow]));
    expect(
      warnings.some((w) => w.category === 'shadowedByBroader' && w.ruleId === specificAllow.id),
    ).toBe(true);
  });

  it('flags overlapping same-action rules', () => {
    const one = makePolicyRule(staff, servers, { serviceId: https.id, action: 'allow' });
    const two = makePolicyRule(staff, servers, { serviceId: https.id, action: 'allow' });
    const warnings = validatePolicyRules(stateWith([one, two]));
    expect(warnings.filter((w) => w.category === 'overlapping')).toHaveLength(2);
  });
});

describe('rule ↔ flow validation (§3.11, improvements M8 #65)', () => {
  const site = makeSite(project.id);
  const zone = makeZone(site);
  const zoneB = makeZone(site, { name: 'zone-b' });
  const deviceA = makeDevice(project.id, { name: 'app01', zoneId: zone.id });
  const deviceB = makeDevice(project.id, { name: 'db01', zoneId: zoneB.id });
  const ifaceA = makeInterface(deviceA, { networkId: staff.id });
  const ifaceB = makeInterface(deviceB, { networkId: servers.id });

  function observedState(rules: PolicyRule[], flows: Flow[]): ProjectState {
    return {
      ...stateWith(rules),
      sites: [site],
      zones: [zone, zoneB],
      devices: [deviceA, deviceB],
      interfaces: [ifaceA, ifaceB],
      flows,
    };
  }

  const flowAB = makeFlow(project.id, {
    source: { kind: 'device', id: deviceA.id },
    destination: { kind: 'device', id: deviceB.id },
    protocol: 'tcp',
    port: 443,
  });

  it('matches a device-endpoint rule to a flow between the devices', () => {
    const rule = makePolicyRule(staff, servers, {
      source: { kind: 'device', id: deviceA.id },
      destination: { kind: 'device', id: deviceB.id },
      action: 'allow',
    });
    expect(ruleMatchesFlow(observedState([rule], [flowAB]), rule, flowAB)).toBe(true);
  });

  it('matches a network-endpoint rule through interface membership', () => {
    const rule = makePolicyRule(staff, servers, { action: 'allow' });
    expect(ruleMatchesFlow(observedState([rule], [flowAB]), rule, flowAB)).toBe(true);
  });

  it('matches a zone-endpoint rule through containment', () => {
    const rule = makePolicyRule(staff, servers, {
      source: { kind: 'zone', id: zone.id },
      destination: { kind: 'zone', id: zoneB.id },
      action: 'allow',
    });
    expect(ruleMatchesFlow(observedState([rule], [flowAB]), rule, flowAB)).toBe(true);
  });

  it('respects direction: a one-way rule does not match reverse traffic', () => {
    const reverse = makeFlow(project.id, {
      source: { kind: 'device', id: deviceB.id },
      destination: { kind: 'device', id: deviceA.id },
      protocol: 'tcp',
      port: 443,
    });
    const oneWay = makePolicyRule(staff, servers, { action: 'allow', direction: 'inbound' });
    const bidi = makePolicyRule(staff, servers, { action: 'allow', direction: 'bidirectional' });
    expect(ruleMatchesFlow(observedState([oneWay], [reverse]), oneWay, reverse)).toBe(false);
    expect(ruleMatchesFlow(observedState([bidi], [reverse]), bidi, reverse)).toBe(true);
  });

  it('respects the service scope: a port-specific rule misses other ports', () => {
    const rule = makePolicyRule(staff, servers, { serviceId: https.id, action: 'allow' });
    const otherPort = makeFlow(project.id, {
      source: { kind: 'device', id: deviceA.id },
      destination: { kind: 'device', id: deviceB.id },
      protocol: 'tcp',
      port: 22,
    });
    expect(ruleMatchesFlow(observedState([rule], [otherPort]), rule, otherPort)).toBe(false);
  });

  it('warns observed-without-rule for an unmatched flow between known devices', () => {
    const unrelated = makePolicyRule(staff, servers, { serviceId: https.id, action: 'allow' });
    const sshFlow = makeFlow(project.id, {
      source: { kind: 'device', id: deviceA.id },
      destination: { kind: 'device', id: deviceB.id },
      protocol: 'tcp',
      port: 22,
    });
    const warnings = validatePolicyRules(observedState([unrelated], [sshFlow]));
    const hit = warnings.find((w) => w.category === 'observedWithoutRule');
    expect(hit).toBeDefined();
    expect(hit?.ruleId).toBeNull();
    expect(hit?.flowId).toBe(sshFlow.id);
    expect(hit?.message).toContain('app01');
  });

  it('never warns observed-without-rule for external peers', () => {
    const externalFlow = makeFlow(project.id); // external → external fixture default
    const warnings = validatePolicyRules(observedState([], [externalFlow]));
    expect(warnings.some((w) => w.category === 'observedWithoutRule')).toBe(false);
  });

  it('warns planned-never-observed for a rule no flow matches, once traffic exists', () => {
    const matched = makePolicyRule(staff, servers, { action: 'allow' });
    const unmatched = makePolicyRule(servers, staff, {
      serviceId: https.id,
      action: 'allow',
      direction: 'inbound',
    });
    const warnings = validatePolicyRules(observedState([matched, unmatched], [flowAB]));
    const infos = warnings.filter((w) => w.category === 'plannedNeverObserved');
    expect(infos.map((w) => w.ruleId)).toEqual([unmatched.id]);
    expect(infos[0]?.message).toContain('not necessarily unnecessary');
  });

  it('stays quiet on planned-never-observed while no traffic was observed at all', () => {
    const rule = makePolicyRule(staff, servers, { action: 'allow' });
    const warnings = validatePolicyRules(observedState([rule], []));
    expect(warnings.some((w) => w.category === 'plannedNeverObserved')).toBe(false);
  });
});
