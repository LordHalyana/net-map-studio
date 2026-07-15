import { describe, expect, it } from 'vitest';
import { invertOperation, newId, operationIdSchema, type Operation } from '../src/index.js';
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
const link = makeLink(iface, makeInterface(device, { name: 'eth1' }));

const ops: Operation[] = [
  {
    id: newId(operationIdSchema),
    projectId: project.id,
    kind: 'CreateEntity',
    payload: { entityType: 'device', entity: device },
  },
  {
    id: newId(operationIdSchema),
    projectId: project.id,
    kind: 'SetField',
    entityType: 'device',
    entityId: device.id,
    field: 'name',
    value: 'after',
    previousValue: 'before',
  },
  {
    id: newId(operationIdSchema),
    projectId: project.id,
    kind: 'CreateLink',
    link,
  },
  {
    id: newId(operationIdSchema),
    projectId: project.id,
    kind: 'SetMembership',
    interfaceId: iface.id,
    networkId: network.id,
    previousNetworkId: null,
  },
  {
    id: newId(operationIdSchema),
    projectId: project.id,
    kind: 'SetContainment',
    deviceId: device.id,
    zoneId: null,
    previousZoneId: null,
  },
];

describe('invertOperation (ADR-0010)', () => {
  it('double inversion yields the original operation (modulo operation id)', () => {
    for (const op of ops) {
      const inverse = invertOperation(op, newId(operationIdSchema));
      const doubled = invertOperation(inverse, op.id);
      expect(doubled).toEqual(op);
    }
  });

  it('inverts SetField by swapping value and previousValue', () => {
    const op = ops[1];
    if (op?.kind !== 'SetField') throw new Error('fixture mismatch');
    const inverse = invertOperation(op, newId(operationIdSchema));
    if (inverse.kind !== 'SetField') throw new Error('inverse kind mismatch');
    expect(inverse.value).toBe('before');
    expect(inverse.previousValue).toBe('after');
  });

  it('inverts CreateLink into DeleteLink carrying the link as snapshot', () => {
    const op = ops[2];
    if (op?.kind !== 'CreateLink') throw new Error('fixture mismatch');
    const inverse = invertOperation(op, newId(operationIdSchema));
    expect(inverse.kind).toBe('DeleteLink');
    if (inverse.kind === 'DeleteLink') {
      expect(inverse.snapshot).toEqual(link);
    }
  });
});
