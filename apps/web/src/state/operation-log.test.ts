import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectState } from '@netplan/domain';
import { makeProject } from '@netplan/domain/fixtures';

const getLogMock = vi.fn();
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  getLog: (projectId: string) => getLogMock(projectId),
}));

import { useAppStore } from './store';

function stateFor(projectId: ProjectState['project']['id']): ProjectState {
  return {
    project: { ...makeProject(), id: projectId },
    sites: [],
    zones: [],
    devices: [],
    interfaces: [],
    addresses: [],
    networks: [],
    links: [],
    services: [],
    policyRules: [],
    flows: [],
    hostArtifacts: [],
    reports: [],
    importProfiles: [],
    secretMatches: [],
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
  };
}

/** #110 D2: the log is fetched once per graph version, shared by all panels. */
describe('refreshOperationLog', () => {
  beforeEach(() => {
    getLogMock.mockReset();
    getLogMock.mockResolvedValue([]);
    const project = makeProject();
    useAppStore.setState({
      project,
      graph: stateFor(project.id),
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
