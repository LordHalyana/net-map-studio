import { describe, expect, it } from 'vitest';
import type { EntityPayload, Operation, Project } from '@netplan/domain';
import { makeDevice, makeFlow, makeNetwork } from '@netplan/domain/fixtures';
import { OperationError } from '../src/engine/store.js';
import { createTestEngine, opId } from './helpers.js';

function createOp(project: Project, payload: EntityPayload): Operation {
  return { id: opId(), projectId: project.id, kind: 'CreateEntity', payload };
}

function deleteOp(project: Project, payload: EntityPayload): Operation {
  return { id: opId(), projectId: project.id, kind: 'DeleteEntity', payload };
}

/**
 * #110 C1: delete-dependency checks are EXISTS-style queries, not full-table
 * loads. Behaviour contract pinned here at Flow volume: the correct delete is
 * still rejected (with the unchanged message) and an unreferenced entity
 * still deletes cleanly with hundreds of Flows in the project.
 */
describe('delete-dependency checks under Flow volume (#110 C1)', () => {
  it('rejects deleting a device one flow references among hundreds', () => {
    const { engine, project } = createTestEngine();
    const [devA, devB, devC, devLone] = [
      makeDevice(project.id, { name: 'referenced' }),
      makeDevice(project.id, { name: 'busy-1' }),
      makeDevice(project.id, { name: 'busy-2' }),
      makeDevice(project.id, { name: 'unreferenced' }),
    ];
    for (const device of [devA, devB, devC, devLone]) {
      engine.applyOperation(createOp(project, { entityType: 'device', entity: device }));
    }
    for (let i = 0; i < 300; i++) {
      engine.applyOperation(
        createOp(project, {
          entityType: 'flow',
          entity: makeFlow(project.id, {
            source: { kind: 'device', id: devB.id },
            destination: { kind: 'device', id: devC.id },
            port: 1000 + i,
          }),
        }),
      );
    }
    engine.applyOperation(
      createOp(project, {
        entityType: 'flow',
        entity: makeFlow(project.id, {
          source: { kind: 'device', id: devA.id },
          destination: { kind: 'external', value: '203.0.113.9' },
        }),
      }),
    );

    expect(() =>
      engine.applyOperation(deleteOp(project, { entityType: 'device', entity: devA })),
    ).toThrow(`Cannot delete device ${devA.id}: a Flow still references it`);
    // …while an unreferenced device still deletes despite the flow volume.
    engine.applyOperation(deleteOp(project, { entityType: 'device', entity: devLone }));
    expect(engine.getState(project.id).devices).toHaveLength(3);
  });

  it('rejects deleting a network a flow references via network/subnet endpoints', () => {
    const { engine, project } = createTestEngine();
    const net = makeNetwork(project.id);
    engine.applyOperation(createOp(project, { entityType: 'network', entity: net }));
    engine.applyOperation(
      createOp(project, {
        entityType: 'flow',
        entity: makeFlow(project.id, {
          source: { kind: 'subnet', id: net.id },
          destination: { kind: 'external', value: '203.0.113.9' },
        }),
      }),
    );

    expect(() =>
      engine.applyOperation(deleteOp(project, { entityType: 'network', entity: net })),
    ).toThrow(OperationError);
  });
});
