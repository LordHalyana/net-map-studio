import { describe, expect, it } from 'vitest';
import type { ObservationDraft } from '@netplan/domain';
import { makeProject } from '@netplan/domain/fixtures';
import { createDb } from '../src/db/index.js';
import { createEngine } from '../src/engine/store.js';
import { createImportStore } from '../src/imports/store.js';
import { ParseLimitError } from '../src/imports/guards.js';
import { projects } from '../src/db/schema.js';
import type { Adapter, AdapterContext } from '../src/imports/adapters/types.js';

/**
 * P4-M5 DoD: a large import can be cancelled mid-run leaving no partial
 * commit, resumed to completion, and run concurrently with another job; a
 * bounded pathological input is rejected rather than OOM-ing. The worker
 * stays queue-shaped (ADR-0019 seam) and the SMB tier is unchanged.
 */

/** A controllable adapter: parses `chunks` units, yielding between each. */
function slowAdapter(observed?: { concurrent: number[]; running: () => void }): Adapter {
  let currentlyRunning = 0;
  return {
    name: 'slow-fixture',
    version: '1.0.0',
    schemaVersion: '1',
    async parse(content: string, ctx: AdapterContext): Promise<ObservationDraft[]> {
      const { chunks, emit } = JSON.parse(content) as { chunks: number; emit?: number };
      currentlyRunning += 1;
      observed?.concurrent.push(currentlyRunning);
      observed?.running();
      try {
        for (let i = 0; i < chunks; i++) {
          ctx.budget.check();
          await new Promise((resolve) => setImmediate(resolve));
        }
        const emitCount = emit ?? 1;
        return Array.from({ length: emitCount }, (_, i) => ({
          contributor: 'stableDeviceId' as const,
          observedAt: null,
          claim: {
            targetKind: 'device' as const,
            device: { stableId: `dev-${i}` },
            fields: { name: `dev-${i}` },
          },
        }));
      } finally {
        currentlyRunning -= 1;
      }
    },
  };
}

function createStore(
  options: {
    limits?: Partial<import('../src/imports/guards.js').ParseLimits>;
    observed?: { concurrent: number[]; running: () => void };
  } = {},
) {
  const { db } = createDb(':memory:');
  const engine = createEngine(db);
  const project = makeProject();
  db.insert(projects).values(project).run();
  const store = createImportStore(db, engine, {
    limits: options.limits,
    adapters: [slowAdapter(options.observed)],
  });
  return { db, engine, store, project };
}

function upload(store: ReturnType<typeof createStore>['store'], projectId: string, body: object) {
  return store.createJob(projectId, {
    filename: 'slow.json',
    adapter: 'slow-fixture',
    content: JSON.stringify(body),
    encoding: 'utf8',
    collectedAt: null,
    retainRaw: false,
  });
}

/** Wait until a condition holds, yielding to the event loop. */
async function until(cond: () => boolean, tries = 1000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition never became true');
}

describe('P4-M5: cancellation', () => {
  it('cancelling a running job stops it at the next checkpoint with no partial rows, and it resumes to completion', async () => {
    const { store, project } = createStore();
    const job = upload(store, project.id, { chunks: 10_000, emit: 3 });

    await until(() => store.getJob(project.id, job.id).status === 'parsing');
    store.cancel(project.id, job.id);
    await store.whenIdle();

    const cancelled = store.getJob(project.id, job.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.progressStage).toBeNull();
    // no partial commit: no observations, no proposal
    expect(store.listObservations(project.id, job.id)).toEqual([]);
    expect(store.getProposal(project.id, job.id)).toBeNull();

    // resume re-runs from the stored Evidence blob to completion
    const resumed = store.resume(project.id, job.id);
    expect(['pending', 'parsing']).toContain(resumed.status);
    await store.whenIdle();
    const done = store.getJob(project.id, job.id);
    expect(done.status).toBe('review');
    expect(store.listObservations(project.id, job.id)).toHaveLength(3);
  }, 20_000);

  it('cancelling a queued job cancels it instantly without running the adapter', async () => {
    const { store, project } = createStore({ limits: { maxConcurrentParses: 1 } });
    const first = upload(store, project.id, { chunks: 5000 });
    const second = upload(store, project.id, { chunks: 1 });

    await until(() => store.getJob(project.id, first.id).status === 'parsing');
    // second is queued behind the concurrency cap
    expect(store.getJob(project.id, second.id).status).toBe('pending');
    store.cancel(project.id, second.id);
    await until(() => store.getJob(project.id, second.id).status === 'cancelled');

    store.cancel(project.id, first.id);
    await store.whenIdle();
  }, 20_000);

  it('a committed job is not cancellable', async () => {
    const { store, project } = createStore();
    const job = upload(store, project.id, { chunks: 1 });
    await store.whenIdle();
    store.commit(project.id, job.id);
    expect(() => store.cancel(project.id, job.id)).toThrow(/not cancellable/);
  });
});

describe('P4-M5: concurrency and the queue shape', () => {
  it('two jobs parse concurrently within the cap', async () => {
    const observed = { concurrent: [] as number[], running: () => undefined };
    const { store, project } = createStore({
      limits: { maxConcurrentParses: 2 },
      observed,
    });
    upload(store, project.id, { chunks: 200 });
    upload(store, project.id, { chunks: 200 });
    await store.whenIdle();
    expect(Math.max(...observed.concurrent)).toBe(2);
    expect(store.listJobs(project.id).every((j) => j.status === 'review')).toBe(true);
  });

  it('jobs beyond the concurrency cap wait as pending (queue-shaped seam)', async () => {
    const { store, project } = createStore({ limits: { maxConcurrentParses: 1 } });
    const first = upload(store, project.id, { chunks: 2000 });
    const second = upload(store, project.id, { chunks: 1 });

    await until(() => store.getJob(project.id, first.id).status === 'parsing');
    const waiting = store.getJob(project.id, second.id);
    expect(waiting.status).toBe('pending');
    expect(waiting.progressStage).toBe('queued');

    await store.whenIdle();
    expect(store.getJob(project.id, second.id).status).toBe('review');
  }, 20_000);
});

describe('P4-M5: backpressure and bounds', () => {
  it('rejects uploads when the queue is full instead of accepting unbounded work', async () => {
    const { store, project } = createStore({
      limits: { maxConcurrentParses: 1, maxQueuedParses: 2 },
    });
    upload(store, project.id, { chunks: 2000 });
    upload(store, project.id, { chunks: 2000 });
    expect(() => upload(store, project.id, { chunks: 1 })).toThrow(ParseLimitError);
    expect(() => upload(store, project.id, { chunks: 1 })).toThrow(/queue is full/);

    // the rejected upload left nothing behind
    expect(store.listJobs(project.id)).toHaveLength(2);
    for (const job of store.listJobs(project.id)) {
      store.cancel(project.id, job.id);
    }
    await store.whenIdle();
  }, 20_000);

  it('a pathological input emitting too many observations fails by policy, not OOM', async () => {
    const { store, project } = createStore({ limits: { maxObservations: 10 } });
    const job = upload(store, project.id, { chunks: 1, emit: 50 });
    await store.whenIdle();
    const failed = store.getJob(project.id, job.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('over the 10');
    expect(store.listObservations(project.id, job.id)).toEqual([]);
  });
});

describe('P4-M5: crash-interrupted jobs are resumable', () => {
  it('a job left parsing by a dead process resumes from its Evidence blob in a fresh store', async () => {
    const { db, engine, store, project } = createStore();
    const job = upload(store, project.id, { chunks: 1, emit: 2 });
    await store.whenIdle();
    expect(store.getJob(project.id, job.id).status).toBe('review');

    // simulate the crash: wind the job back to parsing with stale staged rows
    const { importJobs, importProposals, observations } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    db.update(importJobs)
      .set({ status: 'parsing', progressStage: 'persisting' })
      .where(eq(importJobs.id, job.id))
      .run();
    db.delete(importProposals).where(eq(importProposals.importJobId, job.id)).run();

    // a fresh store (new process) has no in-memory task for it — resume re-runs
    const fresh = createImportStore(db, engine, { adapters: [slowAdapter()] });
    fresh.resume(project.id, job.id);
    await fresh.whenIdle();
    const done = fresh.getJob(project.id, job.id);
    expect(done.status).toBe('review');
    expect(fresh.listObservations(project.id, job.id)).toHaveLength(2);
    expect(db.select().from(observations).all()).toHaveLength(2);
  });
});
