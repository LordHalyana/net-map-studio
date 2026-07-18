import { describe, expect, it } from 'vitest';
import { buildResolutionIndex, type ProjectState } from '../src/index.js';
import {
  makeDevice,
  makeInterface,
  makeNetwork,
  makePolicyRule,
  makeProject,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';

/**
 * #110 B1: the per-run resolution index is the one home for `(kind, id)`
 * resolution inside the findings engine. These tests pin the resolution
 * semantics per endpoint kind — the contract the old per-rule helpers
 * implemented with hand-rolled kind switches.
 */

const project = makeProject();
const site = makeSite(project.id);
const zoneA = makeZone(site, { name: 'Corp' });
const zoneB = makeZone(site, { name: 'OT' });
const netA = makeNetwork(project.id, { name: 'VLAN A' });
const netB = makeNetwork(project.id, { name: 'VLAN B' });
const devA = makeDevice(project.id, { name: 'a', zoneId: zoneA.id });
const devB = makeDevice(project.id, { name: 'b', zoneId: zoneB.id });
const devLone = makeDevice(project.id, { name: 'lone' });
const ifaceA = makeInterface(devA, { networkId: netA.id });
const ifaceB = makeInterface(devB, { networkId: netB.id });

function baseState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    project,
    sites: [site],
    zones: [zoneA, zoneB],
    devices: [devA, devB, devLone],
    interfaces: [ifaceA, ifaceB],
    addresses: [],
    networks: [netA, netB],
    links: [],
    services: [],
    policyRules: [],
    flows: [],
    hostArtifacts: [],
    reports: [],
    importProfiles: [],
    secretMatches: [],
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
    ...overrides,
  };
}

describe('flowEndpointDevice', () => {
  const index = buildResolutionIndex(baseState());

  it('resolves a device endpoint to the device itself', () => {
    expect(index.flowEndpointDevice({ kind: 'device', id: devA.id })).toBe(devA);
  });

  it('resolves an interface endpoint to its owning device', () => {
    expect(index.flowEndpointDevice({ kind: 'interface', id: ifaceB.id })).toBe(devB);
  });

  it('never fabricates a device for network, zone or external endpoints', () => {
    expect(index.flowEndpointDevice({ kind: 'network', id: netA.id })).toBeUndefined();
    expect(index.flowEndpointDevice({ kind: 'zone', id: zoneA.id })).toBeUndefined();
    expect(index.flowEndpointDevice({ kind: 'external', value: '203.0.113.7' })).toBeUndefined();
  });

  it('returns undefined for a dangling reference', () => {
    expect(
      index.flowEndpointDevice({ kind: 'device', id: makeDevice(project.id).id }),
    ).toBeUndefined();
  });
});

describe('deviceNetworkIds', () => {
  const index = buildResolutionIndex(baseState());

  it('reflects interface membership', () => {
    expect([...index.deviceNetworkIds(devA.id)]).toEqual([netA.id]);
  });

  it('is empty for a device with no interfaces', () => {
    expect(index.deviceNetworkIds(devLone.id).size).toBe(0);
  });
});

describe('endpointCoversDevice', () => {
  const index = buildResolutionIndex(baseState());

  it('device endpoint covers exactly that device', () => {
    expect(index.endpointCoversDevice({ kind: 'device', id: devA.id }, devA)).toBe(true);
    expect(index.endpointCoversDevice({ kind: 'device', id: devA.id }, devB)).toBe(false);
  });

  it('interface endpoint covers its owning device only', () => {
    expect(index.endpointCoversDevice({ kind: 'interface', id: ifaceA.id }, devA)).toBe(true);
    expect(index.endpointCoversDevice({ kind: 'interface', id: ifaceA.id }, devB)).toBe(false);
  });

  it('zone endpoint covers devices contained in the zone', () => {
    expect(index.endpointCoversDevice({ kind: 'zone', id: zoneA.id }, devA)).toBe(true);
    expect(index.endpointCoversDevice({ kind: 'zone', id: zoneA.id }, devB)).toBe(false);
    expect(index.endpointCoversDevice({ kind: 'zone', id: zoneA.id }, devLone)).toBe(false);
  });

  it('network and subnet endpoints cover devices via interface membership', () => {
    expect(index.endpointCoversDevice({ kind: 'network', id: netA.id }, devA)).toBe(true);
    expect(index.endpointCoversDevice({ kind: 'subnet', id: netA.id }, devA)).toBe(true);
    expect(index.endpointCoversDevice({ kind: 'network', id: netA.id }, devB)).toBe(false);
  });
});

describe('policyAllows', () => {
  it('honors a forward allow rule between the devices’ networks', () => {
    const allow = makePolicyRule(netA, netB, { action: 'allow', direction: 'inbound' });
    const index = buildResolutionIndex(baseState({ policyRules: [allow] }));
    expect(index.policyAllows(devA, devB)).toBe(true);
    expect(index.policyAllows(devB, devA)).toBe(false);
  });

  it('honors the reverse direction only for bidirectional rules', () => {
    const bidi = makePolicyRule(netA, netB, { action: 'allow', direction: 'bidirectional' });
    const index = buildResolutionIndex(baseState({ policyRules: [bidi] }));
    expect(index.policyAllows(devB, devA)).toBe(true);
  });

  it('ignores non-allow rules', () => {
    const deny = makePolicyRule(netA, netB, { action: 'deny' });
    const index = buildResolutionIndex(baseState({ policyRules: [deny] }));
    expect(index.policyAllows(devA, devB)).toBe(false);
  });
});

describe('endpointExists', () => {
  const index = buildResolutionIndex(baseState());

  it('resolves every kind against its entity table', () => {
    expect(index.endpointExists({ kind: 'device', id: devA.id })).toBe(true);
    expect(index.endpointExists({ kind: 'interface', id: ifaceA.id })).toBe(true);
    expect(index.endpointExists({ kind: 'network', id: netA.id })).toBe(true);
    expect(index.endpointExists({ kind: 'zone', id: zoneA.id })).toBe(true);
  });

  it('aliases subnet endpoints to the Network table', () => {
    expect(index.endpointExists({ kind: 'subnet', id: netA.id })).toBe(true);
  });

  it('is false for dangling references', () => {
    expect(index.endpointExists({ kind: 'device', id: makeDevice(project.id).id })).toBe(false);
    expect(index.endpointExists({ kind: 'subnet', id: makeNetwork(project.id).id })).toBe(false);
  });
});
