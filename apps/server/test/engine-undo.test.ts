import { describe, expect, it } from 'vitest';
import {
  changeSetIdSchema,
  newId,
  type ChangeSet,
  type EntityPayload,
  type Operation,
  type Project,
} from '@netplan/domain';
import {
  makeDevice,
  makeInterface,
  makeLink,
  makeNetwork,
  makePolicyRule,
  makeService,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';
import type { Engine } from '../src/engine/store.js';
import {
  createDeviceOp,
  createInterfaceOp,
  createNetworkOp,
  createTestEngine,
  opId,
} from './helpers.js';

function snapshot(engine: Engine, projectId: string): string {
  return JSON.stringify(engine.getState(projectId));
}

/** A representative sequence touching every operation kind (M2 DoD). */
function representativeSequence(project: Project): Operation[] {
  const site = makeSite(project.id);
  const zone = makeZone(site);
  const deviceA = makeDevice(project.id, { name: 'router-a' });
  const deviceB = makeDevice(project.id, { name: 'switch-b', deviceType: 'switch' });
  const ifaceA = makeInterface(deviceA);
  const ifaceB = makeInterface(deviceB, { name: 'ge-0/0/1' });
  const vlan10 = makeNetwork(project.id, { vlanId: 10 });
  const vlan20 = makeNetwork(project.id, { name: 'Servers VLAN', vlanId: 20 });
  const link = makeLink(ifaceA, ifaceB);
  const service = makeService(project.id);
  const rule = makePolicyRule(vlan10, vlan20, { serviceId: service.id });

  const create = (payload: EntityPayload): Operation => ({
    id: opId(),
    projectId: project.id,
    kind: 'CreateEntity',
    payload,
  });

  return [
    create({ entityType: 'site', entity: site }),
    create({ entityType: 'zone', entity: zone }),
    create({ entityType: 'device', entity: deviceA }),
    create({ entityType: 'device', entity: deviceB }),
    create({ entityType: 'interface', entity: ifaceA }),
    create({ entityType: 'interface', entity: ifaceB }),
    create({ entityType: 'network', entity: vlan10 }),
    create({ entityType: 'network', entity: vlan20 }),
    create({ entityType: 'service', entity: service }),
    {
      id: opId(),
      projectId: project.id,
      kind: 'SetContainment',
      deviceId: deviceA.id,
      zoneId: zone.id,
      previousZoneId: null,
    },
    {
      id: opId(),
      projectId: project.id,
      kind: 'SetMembership',
      interfaceId: ifaceA.id,
      networkId: vlan10.id,
      previousNetworkId: null,
    },
    {
      id: opId(),
      projectId: project.id,
      kind: 'SetField',
      entityType: 'device',
      entityId: deviceA.id,
      field: 'criticality',
      value: 'high',
      previousValue: null,
    },
    { id: opId(), projectId: project.id, kind: 'CreateLink', link },
    { id: opId(), projectId: project.id, kind: 'CreatePolicyRule', rule },
    {
      id: opId(),
      projectId: project.id,
      kind: 'SetField',
      entityType: 'policyRule',
      entityId: rule.id,
      field: 'justification',
      value: 'Segmentation policy',
      previousValue: null,
    },
    {
      id: opId(),
      projectId: project.id,
      kind: 'DeletePolicyRule',
      ruleId: rule.id,
      snapshot: rule,
    },
    { id: opId(), projectId: project.id, kind: 'DeleteLink', linkId: link.id, snapshot: link },
  ];
}

describe('undo/redo restores byte-identical state (M2 DoD)', () => {
  it('applies a representative sequence, undoes it all, redoes it all', () => {
    const { engine, project } = createTestEngine();
    const ops = representativeSequence(project);

    const snapshots: string[] = [snapshot(engine, project.id)];
    for (const op of ops) {
      engine.applyOperation(op);
      snapshots.push(snapshot(engine, project.id));
    }

    // undo everything, checking byte-identical state at every step
    for (let i = ops.length - 1; i >= 0; i--) {
      const result = engine.undo(project.id);
      expect(result).not.toBeNull();
      expect(snapshot(engine, project.id)).toBe(snapshots[i]);
    }
    expect(engine.undo(project.id)).toBeNull();
    expect(engine.availability(project.id)).toEqual({ canUndo: false, canRedo: true });

    // redo everything forward again
    for (let i = 1; i <= ops.length; i++) {
      const result = engine.redo(project.id);
      expect(result).not.toBeNull();
      expect(snapshot(engine, project.id)).toBe(snapshots[i]);
    }
    expect(engine.redo(project.id)).toBeNull();
    expect(engine.availability(project.id)).toEqual({ canUndo: true, canRedo: false });
  });

  it('every apply/undo/redo writes exactly one log row per operation', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);
    engine.applyOperation(createDeviceOp(project, device));
    engine.undo(project.id);
    engine.redo(project.id);

    const log = engine.getLog(project.id);
    expect(log.map((entry) => entry.role)).toEqual(['do', 'undo', 'redo']);
  });

  it('a new mutation clears the redo stack', () => {
    const { engine, project } = createTestEngine();
    engine.applyOperation(createDeviceOp(project, makeDevice(project.id)));
    engine.applyOperation(createDeviceOp(project, makeDevice(project.id, { name: 'd2' })));
    engine.undo(project.id);
    expect(engine.availability(project.id).canRedo).toBe(true);

    engine.applyOperation(createDeviceOp(project, makeDevice(project.id, { name: 'd3' })));
    expect(engine.availability(project.id).canRedo).toBe(false);
  });
});

describe('ChangeSet applies and inverts as a unit (M2 DoD)', () => {
  function deviceWithInterfaceChangeSet(project: Project): ChangeSet {
    const device = makeDevice(project.id);
    const iface = makeInterface(device);
    return {
      id: newId(changeSetIdSchema),
      projectId: project.id,
      label: 'Add device with interface',
      operations: [createDeviceOp(project, device), createInterfaceOp(project, iface)],
    };
  }

  it('applies all operations atomically and undoes them as one unit', () => {
    const { engine, project } = createTestEngine();
    const before = snapshot(engine, project.id);

    engine.applyChangeSet(deviceWithInterfaceChangeSet(project));
    expect(engine.getState(project.id).devices).toHaveLength(1);
    expect(engine.getState(project.id).interfaces).toHaveLength(1);
    const after = snapshot(engine, project.id);

    const result = engine.undo(project.id);
    expect(result?.appliedOperations).toHaveLength(2);
    expect(snapshot(engine, project.id)).toBe(before);

    engine.redo(project.id);
    expect(snapshot(engine, project.id)).toBe(after);
  });

  it('rolls back the whole ChangeSet when one operation fails', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);
    const orphanIface = makeInterface(makeDevice(project.id)); // parent never created
    const changeSet: ChangeSet = {
      id: newId(changeSetIdSchema),
      projectId: project.id,
      label: 'Broken batch',
      operations: [createDeviceOp(project, device), createInterfaceOp(project, orphanIface)],
    };

    expect(() => engine.applyChangeSet(changeSet)).toThrow();
    expect(engine.getState(project.id).devices).toEqual([]);
    expect(engine.getLog(project.id)).toHaveLength(0);
  });

  it('a network membership move is one SetMembership operation, undone as one step', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);
    const iface = makeInterface(device);
    const vlan10 = makeNetwork(project.id, { vlanId: 10 });
    const vlan20 = makeNetwork(project.id, { name: 'v20', vlanId: 20 });
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
    engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'SetMembership',
      interfaceId: iface.id,
      networkId: vlan20.id,
      previousNetworkId: vlan10.id,
    });
    expect(engine.getState(project.id).interfaces[0]?.networkId).toBe(vlan20.id);

    engine.undo(project.id);
    expect(engine.getState(project.id).interfaces[0]?.networkId).toBe(vlan10.id);
  });
});
