import { describe, expect, it } from 'vitest';
import {
  validatePolicyRules,
  type PolicyRule,
  type ProjectState,
  type Service,
} from '../src/index.js';
import { makeNetwork, makePolicyRule, makeProject, makeService } from '@netplan/domain/fixtures';

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
    identities: [],
    roleAssignments: [],
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
