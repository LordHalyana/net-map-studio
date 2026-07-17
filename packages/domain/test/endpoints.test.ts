import { describe, expect, it } from 'vitest';
import {
  endpointResolver,
  endpointSchema,
  isValidLinkEndpoint,
  linkEndpointSchema,
  linkSchema,
  newId,
  policyEndpointSchema,
  projectStateSchema,
  deviceIdSchema,
  interfaceIdSchema,
  networkIdSchema,
  zoneIdSchema,
  type ProjectState,
} from '../src/index.js';
import {
  makeDevice,
  makeInterface,
  makeLink,
  makeNetwork,
  makeProject,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';

const project = makeProject();
const device = makeDevice(project.id);
const iface = makeInterface(device);
const network = makeNetwork(project.id);

describe('Endpoint (ADR-0012)', () => {
  it('accepts each endpoint kind', () => {
    expect(endpointSchema.safeParse({ kind: 'interface', id: iface.id }).success).toBe(true);
    expect(endpointSchema.safeParse({ kind: 'device', id: device.id }).success).toBe(true);
    expect(endpointSchema.safeParse({ kind: 'network', id: network.id }).success).toBe(true);
    expect(endpointSchema.safeParse({ kind: 'subnet', id: network.id }).success).toBe(true);
  });

  it('rejects unknown kinds', () => {
    expect(endpointSchema.safeParse({ kind: 'vibe', id: device.id }).success).toBe(false);
  });
});

describe('Link endpoint constraint: interfaces only', () => {
  it('rejects a Link endpoint that is a device', () => {
    expect(linkEndpointSchema.safeParse({ kind: 'device', id: device.id }).success).toBe(false);
    expect(isValidLinkEndpoint({ kind: 'device', id: device.id })).toBe(false);
  });

  it('rejects a whole Link whose target is a network', () => {
    const link = makeLink(iface, makeInterface(device, { name: 'eth1' }));
    const bad = { ...link, target: { kind: 'network', id: network.id } };
    expect(linkSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts an interface endpoint', () => {
    expect(isValidLinkEndpoint({ kind: 'interface', id: iface.id })).toBe(true);
  });
});

describe('PolicyRule endpoint constraint: broader kinds allowed', () => {
  it('accepts device, network, zone and subnet endpoints', () => {
    expect(policyEndpointSchema.safeParse({ kind: 'device', id: device.id }).success).toBe(true);
    expect(policyEndpointSchema.safeParse({ kind: 'network', id: network.id }).success).toBe(true);
    expect(policyEndpointSchema.safeParse({ kind: 'subnet', id: network.id }).success).toBe(true);
  });
});

describe('Endpoint resolver (#80)', () => {
  const site = makeSite(project.id);
  const zone = makeZone(site);
  const server = makeDevice(project.id, { name: 'Server-1', zoneId: zone.id });
  const eth0 = makeInterface(server, { name: 'eth0', networkId: network.id });
  const other = makeDevice(project.id, { name: 'Laptop-7' });

  function stateWith(overrides: Partial<ProjectState> = {}): ProjectState {
    return projectStateSchema.parse({
      project,
      sites: [site],
      zones: [zone],
      devices: [server, other],
      interfaces: [eth0],
      addresses: [],
      networks: [network],
      links: [],
      services: [],
      policyRules: [],
      ...overrides,
    });
  }

  const resolve = endpointResolver(stateWith());

  describe('entity', () => {
    it('resolves each kind to its entity; subnet resolves against networks', () => {
      expect(resolve.entity({ kind: 'device', id: server.id })).toEqual(server);
      expect(resolve.entity({ kind: 'interface', id: eth0.id })).toEqual(eth0);
      expect(resolve.entity({ kind: 'network', id: network.id })).toEqual(network);
      expect(resolve.entity({ kind: 'subnet', id: network.id })).toEqual(network);
      expect(resolve.entity({ kind: 'zone', id: zone.id })).toEqual(zone);
    });

    it('returns null for dangling references and external literals', () => {
      expect(resolve.entity({ kind: 'device', id: newId(deviceIdSchema) })).toBeNull();
      expect(resolve.entity({ kind: 'external', value: '203.0.113.7' })).toBeNull();
    });
  });

  describe('label', () => {
    it('names resolved entities; an interface composes its owning device', () => {
      expect(resolve.label({ kind: 'device', id: server.id })).toBe('Server-1');
      expect(resolve.label({ kind: 'interface', id: eth0.id })).toBe('Server-1 · eth0');
      expect(resolve.label({ kind: 'network', id: network.id })).toBe(network.name);
      expect(resolve.label({ kind: 'zone', id: zone.id })).toBe(zone.name);
    });

    it('falls back to "(deleted <kind>)" for dangling references', () => {
      expect(resolve.label({ kind: 'device', id: newId(deviceIdSchema) })).toBe('(deleted device)');
      expect(resolve.label({ kind: 'interface', id: newId(interfaceIdSchema) })).toBe(
        '(deleted interface)',
      );
      expect(resolve.label({ kind: 'subnet', id: newId(networkIdSchema) })).toBe(
        '(deleted network)',
      );
      expect(resolve.label({ kind: 'zone', id: newId(zoneIdSchema) })).toBe('(deleted zone)');
    });

    it('labels an external literal with its value', () => {
      expect(resolve.label({ kind: 'external', value: '203.0.113.7' })).toBe(
        '203.0.113.7 (external)',
      );
    });
  });

  describe('deviceId', () => {
    it('is the device itself, or the owner of an interface', () => {
      expect(resolve.deviceId({ kind: 'device', id: server.id })).toBe(server.id);
      expect(resolve.deviceId({ kind: 'interface', id: eth0.id })).toBe(server.id);
    });

    it('is null for non-device kinds and dangling interfaces', () => {
      expect(resolve.deviceId({ kind: 'network', id: network.id })).toBeNull();
      expect(resolve.deviceId({ kind: 'zone', id: zone.id })).toBeNull();
      expect(resolve.deviceId({ kind: 'external', value: 'x' })).toBeNull();
      expect(resolve.deviceId({ kind: 'interface', id: newId(interfaceIdSchema) })).toBeNull();
    });
  });

  describe('touchesDevice', () => {
    it('direct: the device itself or one of its interfaces, nothing wider', () => {
      expect(resolve.touchesDevice({ kind: 'device', id: server.id }, server.id, 'direct')).toBe(
        true,
      );
      expect(resolve.touchesDevice({ kind: 'interface', id: eth0.id }, server.id, 'direct')).toBe(
        true,
      );
      expect(resolve.touchesDevice({ kind: 'network', id: network.id }, server.id, 'direct')).toBe(
        false,
      );
      expect(resolve.touchesDevice({ kind: 'device', id: server.id }, other.id, 'direct')).toBe(
        false,
      );
    });

    it('membership: adds networks the device has an interface in', () => {
      const endpoint = { kind: 'network', id: network.id } as const;
      expect(resolve.touchesDevice(endpoint, server.id, 'membership')).toBe(true);
      expect(resolve.touchesDevice(endpoint, other.id, 'membership')).toBe(false);
      expect(
        resolve.touchesDevice({ kind: 'subnet', id: network.id }, server.id, 'membership'),
      ).toBe(true);
      expect(resolve.touchesDevice({ kind: 'zone', id: zone.id }, server.id, 'membership')).toBe(
        false,
      );
    });

    it("zone: adds the device's zone", () => {
      const endpoint = { kind: 'zone', id: zone.id } as const;
      expect(resolve.touchesDevice(endpoint, server.id, 'zone')).toBe(true);
      expect(resolve.touchesDevice(endpoint, other.id, 'zone')).toBe(false);
      expect(resolve.touchesDevice({ kind: 'network', id: network.id }, server.id, 'zone')).toBe(
        true,
      );
    });
  });
});
