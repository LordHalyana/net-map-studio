import { describe, expect, it } from 'vitest';
import { fromPartial } from '@total-typescript/shoehorn';
import { makeDevice, makeInterface, makeLink, makeNetwork } from '@netplan/domain/fixtures';
import { OperationError } from '../src/engine/store.js';
import {
  createDeviceOp,
  createInterfaceOp,
  createNetworkOp,
  createTestEngine,
  opId,
} from './helpers.js';

describe('applyOperation — the mutation spine (ADR-0010)', () => {
  it('applies CreateEntity and the entity appears in project state', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);

    engine.applyOperation(createDeviceOp(project, device));

    expect(engine.getState(project.id).devices).toEqual([device]);
  });

  it('writes exactly one log row per applied operation', () => {
    const { engine, project } = createTestEngine();
    engine.applyOperation(createDeviceOp(project, makeDevice(project.id)));
    engine.applyOperation(createDeviceOp(project, makeDevice(project.id, { name: 'sw1' })));

    const log = engine.getLog(project.id);
    expect(log).toHaveLength(2);
    expect(log.every((row) => row.role === 'do')).toBe(true);
  });

  it('rejects a malformed operation before touching the database', () => {
    const { engine, project } = createTestEngine();
    const bad = fromPartial<Parameters<typeof engine.applyOperation>[0]>({
      id: opId(),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'device', entity: { name: 'no-id' } },
    });

    expect(() => engine.applyOperation(bad)).toThrow(OperationError);
    expect(engine.getState(project.id).devices).toEqual([]);
    expect(engine.getLog(project.id)).toHaveLength(0);
  });

  it('rejects CreateEntity referencing a missing parent (interface without device)', () => {
    const { engine, project } = createTestEngine();
    const ghost = makeDevice(project.id);
    const iface = makeInterface(ghost);

    expect(() => engine.applyOperation(createInterfaceOp(project, iface))).toThrow(OperationError);
    expect(engine.getLog(project.id)).toHaveLength(0);
  });

  it('rejects creating the same entity id twice', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);
    engine.applyOperation(createDeviceOp(project, device));

    expect(() => engine.applyOperation(createDeviceOp(project, device))).toThrow(OperationError);
    expect(engine.getLog(project.id)).toHaveLength(1);
  });

  it('enriches SetField with the authoritative previous value and applies it', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id, { name: 'core-router' });
    engine.applyOperation(createDeviceOp(project, device));

    const result = engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'SetField',
      entityType: 'device',
      entityId: device.id,
      field: 'name',
      value: 'edge-router',
      previousValue: 'stale-client-guess',
    });

    const applied = result.appliedOperations[0];
    expect(applied?.kind).toBe('SetField');
    if (applied?.kind === 'SetField') {
      expect(applied.previousValue).toBe('core-router');
    }
    expect(engine.getState(project.id).devices[0]?.name).toBe('edge-router');
  });

  it('rejects SetField on identity fields and on values the entity schema refuses', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);
    engine.applyOperation(createDeviceOp(project, device));

    const base = {
      projectId: project.id,
      kind: 'SetField',
      entityType: 'device',
      entityId: device.id,
    } as const;

    expect(() =>
      engine.applyOperation({
        ...base,
        id: opId(),
        field: 'id',
        value: opId(),
        previousValue: null,
      }),
    ).toThrow(OperationError);
    expect(() =>
      engine.applyOperation({
        ...base,
        id: opId(),
        field: 'deviceType',
        value: 'toaster',
        previousValue: null,
      }),
    ).toThrow(OperationError);
    expect(() =>
      engine.applyOperation({
        ...base,
        id: opId(),
        field: 'notAField',
        value: 'x',
        previousValue: null,
      }),
    ).toThrow(OperationError);
  });

  it('enriches DeleteEntity with the authoritative snapshot', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id, { name: 'truth' });
    engine.applyOperation(createDeviceOp(project, device));

    const result = engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'DeleteEntity',
      payload: { entityType: 'device', entity: { ...device, name: 'stale' } },
    });

    const applied = result.appliedOperations[0];
    if (applied?.kind === 'DeleteEntity' && applied.payload.entityType === 'device') {
      expect(applied.payload.entity.name).toBe('truth');
    } else {
      expect.unreachable('expected enriched DeleteEntity');
    }
    expect(engine.getState(project.id).devices).toEqual([]);
  });

  it('rejects deleting an entity that others still reference', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);
    const iface = makeInterface(device);
    engine.applyOperation(createDeviceOp(project, device));
    engine.applyOperation(createInterfaceOp(project, iface));

    expect(() =>
      engine.applyOperation({
        id: opId(),
        projectId: project.id,
        kind: 'DeleteEntity',
        payload: { entityType: 'device', entity: device },
      }),
    ).toThrow(OperationError);
    expect(engine.getState(project.id).devices).toHaveLength(1);
  });

  it('creates Links only between existing interfaces', () => {
    const { engine, project } = createTestEngine();
    const a = makeDevice(project.id, { name: 'a' });
    const b = makeDevice(project.id, { name: 'b' });
    const ifaceA = makeInterface(a);
    const ifaceB = makeInterface(b, { name: 'eth1' });
    for (const op of [
      createDeviceOp(project, a),
      createDeviceOp(project, b),
      createInterfaceOp(project, ifaceA),
      createInterfaceOp(project, ifaceB),
    ]) {
      engine.applyOperation(op);
    }

    const link = makeLink(ifaceA, ifaceB);
    engine.applyOperation({ id: opId(), projectId: project.id, kind: 'CreateLink', link });
    expect(engine.getState(project.id).links).toEqual([link]);

    const ghostLink = makeLink(ifaceA, makeInterface(b, { name: 'ghost' }));
    expect(() =>
      engine.applyOperation({
        id: opId(),
        projectId: project.id,
        kind: 'CreateLink',
        link: ghostLink,
      }),
    ).toThrow(OperationError);
  });

  it('applies SetMembership with enriched previous network (ADR-0013)', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);
    const iface = makeInterface(device);
    const vlan10 = makeNetwork(project.id, { vlanId: 10 });
    const vlan20 = makeNetwork(project.id, { name: 'Servers VLAN', vlanId: 20 });
    for (const op of [
      createDeviceOp(project, device),
      createInterfaceOp(project, iface),
      createNetworkOp(project, vlan10),
      createNetworkOp(project, vlan20),
    ]) {
      engine.applyOperation(op);
    }

    engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'SetMembership',
      interfaceId: iface.id,
      networkId: vlan10.id,
      previousNetworkId: null,
    });
    const result = engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'SetMembership',
      interfaceId: iface.id,
      networkId: vlan20.id,
      previousNetworkId: null, // stale on purpose; engine must enrich
    });

    const applied = result.appliedOperations[0];
    if (applied?.kind === 'SetMembership') {
      expect(applied.previousNetworkId).toBe(vlan10.id);
    } else {
      expect.unreachable('expected SetMembership');
    }
    expect(engine.getState(project.id).interfaces[0]?.networkId).toBe(vlan20.id);
  });
});
