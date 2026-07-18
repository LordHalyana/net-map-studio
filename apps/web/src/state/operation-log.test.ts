import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeProject } from '@netplan/domain/fixtures';
import { emptyState } from './test-helpers';

const getLogMock = vi.fn();
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  getLog: (projectId: string) => getLogMock(projectId),
}));

import { useAppStore } from './store';

/** #110 D2: the log is fetched once per graph version, shared by all panels. */
describe('refreshOperationLog', () => {
  beforeEach(() => {
    getLogMock.mockReset();
    getLogMock.mockResolvedValue([]);
    const project = makeProject();
    useAppStore.setState({
      project,
      graph: { ...emptyState(), project },
      operationLog: [],
      operationLogError: null,
      toasts: [],
    });
  });

  it('fetches once no matter how many panels ask for the same graph version', async () => {
    const refresh = useAppStore.getState().refreshOperationLog;
    await Promise.all([refresh(), refresh(), refresh()]);
    await refresh(); // a late mount after the fetch landed
    expect(getLogMock).toHaveBeenCalledTimes(1);
  });

  it('fetches again when the graph version changes', async () => {
    const store = useAppStore.getState();
    await store.refreshOperationLog();
    const graph = useAppStore.getState().graph;
    if (!graph) throw new Error('graph missing');
    useAppStore.setState({ graph: { ...graph } }); // a new adopted version
    await useAppStore.getState().refreshOperationLog();
    expect(getLogMock).toHaveBeenCalledTimes(2);
  });

  it('invalidateOperationLog refetches even when the graph version did not change', async () => {
    await useAppStore.getState().refreshOperationLog();
    expect(getLogMock).toHaveBeenCalledTimes(1);
    // mutations that bypass dispatch (proposal sign-off, finding
    // dispositions) append log rows without a new graph object
    useAppStore.getState().invalidateOperationLog();
    await Promise.resolve();
    expect(getLogMock).toHaveBeenCalledTimes(2);
  });

  it('routes a failure to the toast queue and the error field — never a blank panel', async () => {
    getLogMock.mockRejectedValueOnce(new Error('server unreachable'));
    await useAppStore.getState().refreshOperationLog();
    expect(useAppStore.getState().operationLogError).toBe('server unreachable');
    expect(useAppStore.getState().toasts.some((t) => t.message === 'server unreachable')).toBe(
      true,
    );
    // the failed version is not marked synced — the next ask retries
    await useAppStore.getState().refreshOperationLog();
    expect(getLogMock).toHaveBeenCalledTimes(2);
  });
});
