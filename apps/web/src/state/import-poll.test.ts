import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from './test-helpers';

const createImportMock = vi.fn();
const getImportDetailMock = vi.fn();
vi.mock('../api/imports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/imports')>()),
  createImport: (projectId: string, input: unknown) => createImportMock(projectId, input),
  getImportDetail: (projectId: string, jobId: string) => getImportDetailMock(projectId, jobId),
}));

import { useAppStore } from './store';
import type { ImportJobDetail } from '../api/imports';

/**
 * #110 D6: starting a second import supersedes the first one's poll loop —
 * a stale poll must never overwrite the newer job's view state.
 */

function job(id: string, status: string) {
  return { id, status } as unknown as ImportJobDetail['job'];
}

function detail(id: string, status: string): ImportJobDetail {
  return {
    job: job(id, status),
    evidence: [],
    observations: [],
    proposal: null,
  } as unknown as ImportJobDetail;
}

describe('uploadImport polling generation guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createImportMock.mockReset();
    getImportDetailMock.mockReset();
    const graph = emptyState();
    useAppStore.setState({
      project: graph.project,
      graph,
      importJobs: [],
      selectedImport: null,
      toasts: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a superseded poll never resurrects the first job’s state', async () => {
    // job1 parses forever (until it would eventually "complete" stale)
    createImportMock.mockResolvedValueOnce(job('job-1', 'parsing'));
    let job1Polls = 0;
    getImportDetailMock.mockImplementation((_p: string, jobId: string) => {
      if (jobId === 'job-1') {
        job1Polls += 1;
        // after a few polls the stale loop sees a terminal state
        return Promise.resolve(detail('job-1', job1Polls >= 2 ? 'review' : 'parsing'));
      }
      return Promise.resolve(detail('job-2', 'review'));
    });

    const first = useAppStore.getState().uploadImport({
      filename: 'a.json',
      adapter: 'device-state',
      content: '{}',
    });
    await vi.advanceTimersByTimeAsync(0); // job1 createImport + first poll (parsing)

    // second import starts while the first still polls
    createImportMock.mockResolvedValueOnce(job('job-2', 'parsing'));
    const second = useAppStore.getState().uploadImport({
      filename: 'b.json',
      adapter: 'device-state',
      content: '{}',
    });
    await vi.advanceTimersByTimeAsync(0); // job2 create + poll → review, adopted
    expect(useAppStore.getState().selectedImport?.job.id).toBe('job-2');

    // let job1's loop wake up and observe its (stale) terminal state
    await vi.advanceTimersByTimeAsync(1000);
    await first;
    await second;

    expect(job1Polls).toBeGreaterThanOrEqual(1);
    // the stale loop must not have overwritten the newer job's state
    expect(useAppStore.getState().selectedImport?.job.id).toBe('job-2');
  });
});
