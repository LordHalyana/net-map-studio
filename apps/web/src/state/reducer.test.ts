import { describe, expect, it } from 'vitest';
import {
  changeSetIdSchema,
  newId,
  operationIdSchema,
  type Operation,
  type ProjectState,
} from '@netplan/domain';
import {
  makeDevice,
  makeInterface,
  makeLink,
  makeNetwork,
  makePolicyRule,
  makeProject,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';
import { applyOperationOptimistic } from './reducer';
import { emptyState } from './test-helpers';

const opId = () => newId(operationIdSchema);

/**
 * #110 D3: table-driven optimistic reducer coverage — the client mirror must
 * track what the server engine will do for every Operation kind.
 */

const project = makeProject();
const site = makeSite(project.id);
const zone = makeZone(site);
const device = makeDevice(project.id, { name: 'dev' });
const iface = makeInterface(device);
const other = makeDevice(project.id, { name: 'other' });
const otherIface = makeInterface(other);
const network = makeNetwork(project.id);
const link = makeLink(iface, otherIface);
const rule = makePolicyRule(network, network);

function baseState(): ProjectState {
  return {
    ...emptyState(project),
    sites: [site],
    zones: [zone],
    devices: [device, other],
    interfaces: [iface, otherIface],
    networks: [network],
    links: [link],
    policyRules: [rule],
  };
}

const cases: {
  name: string;
  op: Operation;
  assert: (next: ProjectState, before: ProjectState) => void;
}[] = [
  {
    name: 'CreateEntity adds to the right collection',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'device', entity: makeDevice(project.id, { name: 'new' }) },
    },
    assert: (next) => expect(next.devices).toHaveLength(3),
  },
  {
    name: 'DeleteEntity removes by id',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'DeleteEntity',
      payload: { entityType: 'device', entity: other },
    },
    assert: (next) => expect(next.devices.map((d) => d.id)).toEqual([device.id]),
  },
  {
    name: 'SetField patches the entity',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'SetField',
      entityType: 'device',
      entityId: device.id,
      field: 'name',
      value: 'renamed',
      previousValue: 'dev',
    },
    assert: (next) => expect(next.devices.find((d) => d.id === device.id)?.name).toBe('renamed'),
  },
  {
    name: 'SetField on the project patches the project',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'SetField',
      entityType: 'project',
      entityId: project.id,
      field: 'name',
      value: 'renamed project',
      previousValue: project.name,
    },
    assert: (next) => expect(next.project.name).toBe('renamed project'),
  },
  {
    name: 'CreateLink appends',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'CreateLink',
      link: makeLink(iface, otherIface, { label: 'second' }),
    },
    assert: (next) => expect(next.links).toHaveLength(2),
  },
  {
    name: 'DeleteLink removes by id',
    op: { id: opId(), projectId: project.id, kind: 'DeleteLink', linkId: link.id, snapshot: link },
    assert: (next) => expect(next.links).toHaveLength(0),
  },
  {
    name: 'CreatePolicyRule appends',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'CreatePolicyRule',
      rule: makePolicyRule(network, network),
    },
    assert: (next) => expect(next.policyRules).toHaveLength(2),
  },
  {
    name: 'DeletePolicyRule removes by id',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'DeletePolicyRule',
      ruleId: rule.id,
      snapshot: rule,
    },
    assert: (next) => expect(next.policyRules).toHaveLength(0),
  },
  {
    name: 'SetMembership assigns the interface network',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'SetMembership',
      interfaceId: iface.id,
      networkId: network.id,
      previousNetworkId: null,
    },
    assert: (next) =>
      expect(next.interfaces.find((i) => i.id === iface.id)?.networkId).toBe(network.id),
  },
  {
    name: 'SetContainment moves the device into the zone',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'SetContainment',
      deviceId: device.id,
      zoneId: zone.id,
      previousZoneId: null,
    },
    assert: (next) => expect(next.devices.find((d) => d.id === device.id)?.zoneId).toBe(zone.id),
  },
  {
    name: 'SetFindingStatus is not canvas state — untouched mirror',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'SetFindingStatus',
      fingerprint: 'fp',
      status: 'acknowledged',
      previousStatus: 'new',
    },
    assert: (next, before) => expect(next).toBe(before),
  },
  {
    name: 'SetFindingNote is not canvas state — untouched mirror',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'SetFindingNote',
      fingerprint: 'fp',
      note: 'a note',
      previousNote: '',
    },
    assert: (next, before) => expect(next).toBe(before),
  },
  {
    name: 'SetChangeSetReviewStatus is not canvas state — untouched mirror',
    op: {
      id: opId(),
      projectId: project.id,
      kind: 'SetChangeSetReviewStatus',
      changeSetId: newId(changeSetIdSchema),
      status: 'proposed',
      note: '',
      previousStatus: 'draft',
      previousNote: '',
    },
    assert: (next, before) => expect(next).toBe(before),
  },
];

describe('applyOperationOptimistic', () => {
  it.each(cases)('$name', ({ op, assert }) => {
    const before = baseState();
    const next = applyOperationOptimistic(before, op);
    assert(next, before);
  });

  it('never mutates the input state', () => {
    const before = baseState();
    const snapshot = JSON.stringify(before);
    applyOperationOptimistic(before, {
      id: opId(),
      projectId: project.id,
      kind: 'DeleteEntity',
      payload: { entityType: 'device', entity: device },
    });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
