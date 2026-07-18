import { describe, expect, it } from 'vitest';
import { changeSetSchema, operationSchema, type Operation } from '@netplan/domain';
import {
  makeAddress,
  makeDevice,
  makeInterface,
  makeLink,
  makeNetwork,
  makePolicyRule,
  makeProject,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';
import {
  changeSet,
  deleteDevicesChangeSet,
  deleteSiteChangeSet,
  deleteZoneChangeSet,
  duplicateDevicesChangeSet,
  opCreateDevice,
  opCreateEntity,
  opCreateLink,
  opCreatePolicyRule,
  opDeleteEntity,
  opDeleteLink,
  opDeletePolicyRule,
  opRestoreAbsolutePosition,
  opSetContainment,
  opSetField,
  opSetMembership,
  opSetNetworkLayoutHint,
  pasteDevicesChangeSet,
} from './ops';
import { emptyState } from './test-helpers';

/**
 * #110 D3: every builder's output round-trips through the domain operation
 * contract — the client cannot drift from what the server engine accepts.
 */

const project = makeProject();
const site = makeSite(project.id);
const zone = makeZone(site);
const device = makeDevice(project.id, { zoneId: zone.id });
const iface = makeInterface(device);
const other = makeDevice(project.id, { name: 'other' });
const otherIface = makeInterface(other);
const address = makeAddress(iface);
const network = makeNetwork(project.id);
const link = makeLink(iface, otherIface);
const rule = makePolicyRule(network, network);

function populatedState() {
  return {
    ...emptyState(project),
    sites: [site],
    zones: [zone],
    devices: [device, other],
    interfaces: [iface, otherIface],
    addresses: [address],
    networks: [network],
    links: [link],
    policyRules: [rule],
  };
}

const operationCases: { name: string; build: () => Operation | null }[] = [
  {
    name: 'opCreateEntity',
    build: () => opCreateEntity(project.id, { entityType: 'device', entity: device }),
  },
  {
    name: 'opDeleteEntity',
    build: () => opDeleteEntity(project.id, { entityType: 'device', entity: device }),
  },
  { name: 'opCreateDevice', build: () => opCreateDevice(project.id, device) },
  {
    name: 'opSetField',
    build: () => opSetField(project.id, 'device', device.id, 'name', 'x', device.name),
  },
  {
    name: 'opSetMembership',
    build: () => opSetMembership(project.id, iface.id, network.id, null),
  },
  {
    name: 'opSetContainment',
    build: () => opSetContainment(project.id, device.id, zone.id, null),
  },
  {
    name: 'opRestoreAbsolutePosition',
    build: () => opRestoreAbsolutePosition(project.id, device, populatedState()),
  },
  {
    name: 'opSetNetworkLayoutHint',
    build: () => opSetNetworkLayoutHint(project.id, network, 'main', { x: 10, y: 20 }),
  },
  { name: 'opCreateLink', build: () => opCreateLink(project.id, link) },
  { name: 'opDeleteLink', build: () => opDeleteLink(project.id, link) },
  { name: 'opCreatePolicyRule', build: () => opCreatePolicyRule(project.id, rule) },
  { name: 'opDeletePolicyRule', build: () => opDeletePolicyRule(project.id, rule) },
];

describe('operation builders round-trip through the domain schema', () => {
  it.each(operationCases)('$name', ({ build }) => {
    const op = build();
    if (op === null) throw new Error('builder unexpectedly returned null');
    const parsed = operationSchema.safeParse(op);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

const changeSetCases: { name: string; build: () => ReturnType<typeof changeSet> | null }[] = [
  {
    name: 'changeSet',
    build: () => changeSet(project.id, 'label', [opCreateDevice(project.id, device)]),
  },
  {
    name: 'deleteDevicesChangeSet',
    build: () => deleteDevicesChangeSet(populatedState(), [device.id]),
  },
  { name: 'deleteZoneChangeSet', build: () => deleteZoneChangeSet(populatedState(), zone.id) },
  { name: 'deleteSiteChangeSet', build: () => deleteSiteChangeSet(populatedState(), site.id) },
  {
    name: 'pasteDevicesChangeSet',
    build: () =>
      pasteDevicesChangeSet(populatedState(), {
        devices: [device],
        interfaces: [iface],
        addresses: [address],
      }),
  },
  {
    name: 'duplicateDevicesChangeSet',
    build: () => duplicateDevicesChangeSet(populatedState(), [device.id]),
  },
];

describe('ChangeSet builders round-trip through the domain schema', () => {
  it.each(changeSetCases)('$name', ({ build }) => {
    const set = build();
    if (set === null) throw new Error('builder unexpectedly returned null');
    const parsed = changeSetSchema.safeParse(set);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(set.operations.length).toBeGreaterThan(0);
  });
});
