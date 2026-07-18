import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutationResponse, ProjectState } from '@netplan/domain';
import { makeDevice } from '@netplan/domain/fixtures';
import { deferred, emptyState } from './test-helpers';

const postOperationMock = vi.fn();
const getGraphMock = vi.fn();
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  postOperation: (projectId: string, payload: unknown) => postOperationMock(projectId, payload),
  getGraph: (projectId: string) => getGraphMock(projectId),
}));

import { useAppStore } from './store';
import { opCreateDevice } from './ops';

/**
 * #110 D3: the optimistic-sync core — apply-now, serialize the queue, adopt
 * the server graph only when idle, roll back on failure. This is the
 * adopt-only-when-`pendingOps === 0` window that previously had zero tests.
 */

function response(state: ProjectState, watermark: number): MutationResponse {
  return {
    appliedOperations: [],
    availability: { canUndo: true, canRedo: false },
    state,
    watermark,
  };
}

function setupProject() {
  const graph = emptyState();
  useAppStore.setState({
    project: graph.project,
    graph,
    pendingOps: 0,
    syncError: null,
    toasts: [],
    watermark: null,
  });
  return graph;
}

// the dispatch sync queue settles between microtasks
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  postOperationMock.mockReset();
  getGraphMock.mockReset();
});

describe('dispatch: optimistic apply', () => {
  it('shows the operation locally before the server responds', async () => {
    const graph = setupProject();
    const pending = deferred<MutationResponse>();
    postOperationMock.mockReturnValue(pending.promise);

    const device = makeDevice(graph.project.id);
    useAppStore.getState().dispatch(opCreateDevice(graph.project.id, device));

    const now = useAppStore.getState();
    expect(now.graph?.devices.map((d) => d.id)).toContain(device.id);
    expect(now.pendingOps).toBe(1);

    // drain the module-level sync queue so the next test starts idle
    pending.resolve(response(graph, 1));
    await settle();
  });
});

describe('dispatch: adopt-server-state-only-when-idle', () => {
  it('does not adopt a response while newer operations are in flight, then adopts after drain', async () => {
    const graph = setupProject();
    const first = deferred<MutationResponse>();
    const second = deferred<MutationResponse>();
    postOperationMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const devA = makeDevice(graph.project.id, { name: 'a' });
    const devB = makeDevice(graph.project.id, { name: 'b' });
    useAppStore.getState().dispatch(opCreateDevice(graph.project.id, devA));
    useAppStore.getState().dispatch(opCreateDevice(graph.project.id, devB));
    expect(useAppStore.getState().pendingOps).toBe(2);

    // the first ack lands while B is still pending — the (stale) server graph
    // must NOT replace the optimistic one
    const serverAfterA: ProjectState = { ...graph, devices: [devA] };
    first.resolve(response(serverAfterA, 1));
    await settle();
    const mid = useAppStore.getState();
    expect(mid.pendingOps).toBe(1);
    expect(mid.graph?.devices.map((d) => d.id)).toEqual([devA.id, devB.id]);
    expect(mid.watermark).toBe(1);

    // the queue drains — now the authoritative graph is adopted
    const serverAfterB: ProjectState = { ...graph, devices: [devA, devB] };
    second.resolve(response(serverAfterB, 2));
    await settle();
    const done = useAppStore.getState();
    expect(done.pendingOps).toBe(0);
    expect(done.graph).toBe(serverAfterB);
    expect(done.watermark).toBe(2);
  });
});

describe('dispatch: rollback on failure', () => {
  it('toasts, refetches the authoritative graph and clears pending', async () => {
    const graph = setupProject();
    postOperationMock.mockRejectedValueOnce(new Error('CONFLICT: nope'));
    const serverGraph = { ...graph };
    getGraphMock.mockResolvedValueOnce(serverGraph);

    const device = makeDevice(graph.project.id);
    useAppStore.getState().dispatch(opCreateDevice(graph.project.id, device));
    await settle();

    const now = useAppStore.getState();
    expect(now.graph).toBe(serverGraph); // optimistic device rolled back
    expect(now.pendingOps).toBe(0);
    expect(now.syncError).toBe('CONFLICT: nope');
    expect(now.toasts.some((t) => t.message === 'CONFLICT: nope')).toBe(true);
  });

  it('still clears pending when the rollback refetch also fails', async () => {
    const graph = setupProject();
    postOperationMock.mockRejectedValueOnce(new Error('sync failed'));
    getGraphMock.mockRejectedValueOnce(new Error('also down'));

    useAppStore.getState().dispatch(opCreateDevice(graph.project.id, makeDevice(graph.project.id)));
    await settle();

    expect(useAppStore.getState().pendingOps).toBe(0);
    expect(useAppStore.getState().syncError).toBe('sync failed');
  });
});

describe('dispatch: queue serialization', () => {
  it('sends one operation at a time — the second POST waits for the first ack', async () => {
    const graph = setupProject();
    const first = deferred<MutationResponse>();
    postOperationMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response(graph, 2));

    useAppStore.getState().dispatch(opCreateDevice(graph.project.id, makeDevice(graph.project.id)));
    useAppStore.getState().dispatch(opCreateDevice(graph.project.id, makeDevice(graph.project.id)));
    await settle();
    expect(postOperationMock).toHaveBeenCalledTimes(1);

    first.resolve(response(graph, 1));
    await settle();
    expect(postOperationMock).toHaveBeenCalledTimes(2);
  });
});
