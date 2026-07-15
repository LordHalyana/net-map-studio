import { describe, expect, it } from 'vitest';
import {
  endpointSchema,
  isValidLinkEndpoint,
  linkEndpointSchema,
  linkSchema,
  policyEndpointSchema,
} from '../src/index.js';
import {
  makeDevice,
  makeInterface,
  makeLink,
  makeNetwork,
  makeProject,
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
