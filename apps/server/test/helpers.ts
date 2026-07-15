import {
  newId,
  operationIdSchema,
  type Device,
  type Interface,
  type Network,
  type Operation,
  type Project,
} from '@netplan/domain';
import { makeProject } from '@netplan/domain/fixtures';
import { createDb } from '../src/db/index.js';
import { createEngine, type Engine } from '../src/engine/store.js';

export function createTestEngine(): { engine: Engine; project: Project } {
  const { db } = createDb(':memory:');
  const engine = createEngine(db);
  const project = makeProject();
  engine.createProject(project);
  return { engine, project };
}

export function opId() {
  return newId(operationIdSchema);
}

export function createDeviceOp(project: Project, device: Device): Operation {
  return {
    id: opId(),
    projectId: project.id,
    kind: 'CreateEntity',
    payload: { entityType: 'device', entity: device },
  };
}

export function createInterfaceOp(project: Project, iface: Interface): Operation {
  return {
    id: opId(),
    projectId: project.id,
    kind: 'CreateEntity',
    payload: { entityType: 'interface', entity: iface },
  };
}

export function createNetworkOp(project: Project, network: Network): Operation {
  return {
    id: opId(),
    projectId: project.id,
    kind: 'CreateEntity',
    payload: { entityType: 'network', entity: network },
  };
}
