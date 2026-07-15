import { describe, expect, it } from 'vitest';
import { fromPartial } from '@total-typescript/shoehorn';
import {
  changeSetIdSchema,
  changeSetSchema,
  newId,
  operationIdSchema,
  operationSchema,
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
const network = makeNetwork(project.id);

describe('Operation schemas', () => {
  it('accepts a CreateEntity operation carrying a device', () => {
    const op = {
      id: newId(operationIdSchema),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'device', entity: device },
    };
    expect(operationSchema.parse(op)).toEqual(op);
  });

  it('rejects a CreateEntity whose payload does not match its entityType', () => {
    const op = fromPartial({
      id: newId(operationIdSchema),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'network', entity: device },
    });
    expect(operationSchema.safeParse(op).success).toBe(false);
  });

  it('accepts a SetField operation with value and previousValue', () => {
    const op = {
      id: newId(operationIdSchema),
      projectId: project.id,
      kind: 'SetField',
      entityType: 'device',
      entityId: device.id,
      field: 'name',
      value: 'edge-router',
      previousValue: 'core-router',
    };
    expect(operationSchema.parse(op)).toEqual(op);
  });

  it('accepts SetMembership with nullable previous network', () => {
    const iface = makeInterface(device);
    const op = {
      id: newId(operationIdSchema),
      projectId: project.id,
      kind: 'SetMembership',
      interfaceId: iface.id,
      networkId: network.id,
      previousNetworkId: null,
    };
    expect(operationSchema.parse(op)).toEqual(op);
  });

  it('accepts DeleteLink carrying its snapshot', () => {
    const other = makeDevice(project.id, { name: 'sw1', deviceType: 'switch' });
    const link = makeLink(makeInterface(device), makeInterface(other));
    const op = {
      id: newId(operationIdSchema),
      projectId: project.id,
      kind: 'DeleteLink',
      linkId: link.id,
      snapshot: link,
    };
    expect(operationSchema.parse(op)).toEqual(op);
  });

  it('rejects an unknown operation kind', () => {
    const op = fromPartial({
      id: newId(operationIdSchema),
      projectId: project.id,
      kind: 'TeleportEntity',
    });
    expect(operationSchema.safeParse(op).success).toBe(false);
  });
});

describe('ChangeSet schema', () => {
  it('requires at least one operation and a label', () => {
    const op = {
      id: newId(operationIdSchema),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'device', entity: device },
    };
    const changeSet = {
      id: newId(changeSetIdSchema),
      projectId: project.id,
      label: 'Add core router',
      operations: [op],
    };
    expect(changeSetSchema.parse(changeSet)).toEqual(changeSet);
    expect(changeSetSchema.safeParse({ ...changeSet, operations: [] }).success).toBe(false);
  });
});
