import { describe, expect, it } from 'vitest';
import { fromPartial } from '@total-typescript/shoehorn';
import {
  addressSchema,
  deviceSchema,
  interfaceSchema,
  linkSchema,
  networkSchema,
  policyRuleSchema,
  projectSchema,
  serviceSchema,
  siteSchema,
  zoneSchema,
} from '../src/index.js';
import {
  makeAddress,
  makeDevice,
  makeInterface,
  makeLink,
  makeNetwork,
  makePolicyRule,
  makeProject,
  makeService,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';

const project = makeProject();
const site = makeSite(project.id);
const zone = makeZone(site);
const device = makeDevice(project.id);
const iface = makeInterface(device);
const address = makeAddress(iface);
const network = makeNetwork(project.id);
const device2 = makeDevice(project.id, { name: 'core-switch', deviceType: 'switch' });
const iface2 = makeInterface(device2, { name: 'ge-0/0/1' });
const link = makeLink(iface, iface2);
const service = makeService(project.id);
const rule = makePolicyRule(network, makeNetwork(project.id, { name: 'Servers VLAN', vlanId: 20 }));

describe('entity schemas accept valid objects', () => {
  it.each([
    ['project', projectSchema, project],
    ['site', siteSchema, site],
    ['zone', zoneSchema, zone],
    ['device', deviceSchema, device],
    ['interface', interfaceSchema, iface],
    ['address', addressSchema, address],
    ['network', networkSchema, network],
    ['link', linkSchema, link],
    ['service', serviceSchema, service],
    ['policyRule', policyRuleSchema, rule],
  ])('%s round-trips through its schema', (_name, schema, value) => {
    expect(schema.parse(value)).toEqual(value);
  });
});

describe('entity schemas reject malformed objects', () => {
  it('rejects a device with an unknown type', () => {
    expect(deviceSchema.safeParse(fromPartial({ ...device, deviceType: 'toaster' })).success).toBe(
      false,
    );
  });

  it('rejects a device with an empty name', () => {
    expect(deviceSchema.safeParse({ ...device, name: '' }).success).toBe(false);
  });

  it('rejects a network with an out-of-range VLAN id', () => {
    expect(networkSchema.safeParse({ ...network, vlanId: 5000 }).success).toBe(false);
  });

  it('rejects a service with an out-of-range port', () => {
    expect(serviceSchema.safeParse({ ...service, portStart: 99999 }).success).toBe(false);
  });

  it('rejects an interface with a non-uuid device reference', () => {
    expect(interfaceSchema.safeParse(fromPartial({ ...iface, deviceId: 'device-1' })).success).toBe(
      false,
    );
  });

  it('rejects an unknown lifecycleState', () => {
    expect(
      deviceSchema.safeParse(fromPartial({ ...device, lifecycleState: 'imaginary' })).success,
    ).toBe(false);
  });
});

describe('lifecycleState defaults', () => {
  it('defaults Phase-1 objects to planned', () => {
    expect(device.lifecycleState).toBe('planned');
    expect(link.lifecycleState).toBe('planned');
    expect(rule.lifecycleState).toBe('planned');
  });
});

describe('container size (M1, #58)', () => {
  it('defaults to null so pre-size bundles still parse', () => {
    const omitSize = (entity: object) =>
      Object.fromEntries(Object.entries(entity).filter(([key]) => key !== 'size'));
    expect(siteSchema.parse(omitSize(site)).size).toBeNull();
    expect(zoneSchema.parse(omitSize(zone)).size).toBeNull();
  });

  it('accepts operator-set dimensions on sites and zones', () => {
    expect(siteSchema.parse({ ...site, size: { width: 600, height: 420 } }).size).toEqual({
      width: 600,
      height: 420,
    });
    expect(zoneSchema.parse({ ...zone, size: { width: 260, height: 180 } }).size).toEqual({
      width: 260,
      height: 180,
    });
  });

  it('rejects non-positive dimensions', () => {
    expect(siteSchema.safeParse({ ...site, size: { width: 0, height: 300 } }).success).toBe(false);
    expect(zoneSchema.safeParse({ ...zone, size: { width: 200, height: -1 } }).success).toBe(false);
  });
});
