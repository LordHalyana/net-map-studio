import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ImportJob, NetplanBundle, Observation } from '@netplan/domain';
import { buildApp } from '../src/app.js';
import { createImportStore } from '../src/imports/store.js';
import { createDb } from '../src/db/index.js';
import { createEngine } from '../src/engine/store.js';
import { ParseLimitError, checkJsonDepth, DEFAULT_PARSE_LIMITS } from '../src/imports/guards.js';
import { makeProject } from '@netplan/domain/fixtures';

/** M1 DoD (plan §2): evidence store, ImportJob state machine, worker limits, bundle subtree. */

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance): Promise<{ id: string }> {
  const res = await app.inject({ method: 'POST', url: '/projects', payload: { name: 'P2' } });
  expect(res.statusCode).toBe(201);
  return res.json();
}

const FIXTURE_FILE = JSON.stringify({
  fixture: true,
  devices: [
    { name: 'web01', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.10', hostname: 'web01' },
    { name: 'db01', stableId: 'machine-db01', ip: '10.0.0.20' },
  ],
});

async function uploadFixture(
  app: FastifyInstance,
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<ImportJob> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/imports`,
    payload: { filename: 'fixture.json', adapter: 'fixture', content: FIXTURE_FILE, ...overrides },
  });
  expect(res.statusCode).toBe(202);
  return res.json();
}

describe('M1: ImportJob framework', () => {
  it('creates a job, hashes evidence on ingest, and the worker parses it to review', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const job = await uploadFixture(app, project.id);

    expect(['pending', 'parsing']).toContain(job.status);
    expect(job.parserName).toBe('fixture');
    expect(job.schemaVersion).toBe('1');

    await app.importStore.whenIdle();
    const detail = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/imports/${job.id}` })
      .then((r) => r.json());

    expect(detail.job.status).toBe('review');
    expect(detail.evidence).toHaveLength(1);
    const evidence = detail.evidence[0];
    expect(evidence.sha256).toBe(createHash('sha256').update(FIXTURE_FILE, 'utf8').digest('hex'));
    expect(evidence.sizeBytes).toBe(Buffer.byteLength(FIXTURE_FILE));
    expect(evidence.contentClass).toBe('structured');
    expect(evidence.retention).toBe('inline');

    // canned observations: 2 devices + 2 addresses for web01 + 1 address for db01
    expect(detail.observations).toHaveLength(5);
    const kinds = detail.observations.map((o: Observation) => o.claim.targetKind);
    expect(kinds.filter((k: string) => k === 'device')).toHaveLength(2);
    expect(kinds.filter((k: string) => k === 'address')).toHaveLength(3);
    const contributors = detail.observations.map((o: Observation) => o.contributor);
    expect(contributors).toContain('exactMacMatch');
    expect(contributors).toContain('stableDeviceId');

    // the stored blob is byte-identical and read-only (no mutation route exists)
    const blob = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/evidence/${evidence.id}` })
      .then((r) => r.json());
    expect(blob.content).toBe(FIXTURE_FILE);
    const evidenceWrites = app.registeredRoutes.filter(
      (r) => r.includes('/evidence') && !r.startsWith('GET') && !r.startsWith('HEAD'),
    );
    expect(evidenceWrites).toEqual([]);
  });

  it('a malformed file fails the job without crashing the app', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const job = await uploadFixture(app, project.id, { content: 'this is not json {' });

    await app.importStore.whenIdle();
    const detail = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/imports/${job.id}` })
      .then((r) => r.json());
    expect(detail.job.status).toBe('failed');
    expect(detail.job.error).toContain('Parse failed');
    expect(detail.job.finishedAt).not.toBeNull();

    // the app is still healthy
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
  });

  it('lists jobs per project', async () => {
    const app = await createApp();
    const project = await createProject(app);
    await uploadFixture(app, project.id);
    await uploadFixture(app, project.id);
    await app.importStore.whenIdle();
    const list = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/imports` })
      .then((r) => r.json());
    expect(list).toHaveLength(2);
  });

  it('rejects an upload for an unknown adapter or missing project', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const bad = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports`,
      payload: { filename: 'x.json', adapter: 'nope', content: '{}' },
    });
    expect(bad.statusCode).toBe(400);

    const ghost = makeProject();
    const missing = await app.inject({
      method: 'POST',
      url: `/projects/${ghost.id}/imports`,
      payload: { filename: 'x.json', adapter: 'fixture', content: '{}' },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('M1: worker limits (ADR-0019)', () => {
  it('rejects an over-limit file at ingest without crashing', async () => {
    const { db } = createDb(':memory:');
    const engine = createEngine(db);
    const project = makeProject();
    engine.createProject(project);
    const store = createImportStore(db, { limits: { maxFileBytes: 64 } });

    expect(() =>
      store.createJob(project.id, {
        filename: 'big.json',
        adapter: 'fixture',
        content: 'x'.repeat(65),
        encoding: 'utf8',
        collectedAt: null,
        retainRaw: false,
      }),
    ).toThrow(ParseLimitError);
    // no job was created
    expect(store.listJobs(project.id)).toHaveLength(0);
  });

  it('rejects a decompression bomb by output cap', async () => {
    const { db } = createDb(':memory:');
    const engine = createEngine(db);
    const project = makeProject();
    engine.createProject(project);
    const store = createImportStore(db, { limits: { maxDecompressionRatio: 10 } });

    // 16MB of zeros compresses to ~16KB: ratio far beyond 10
    const bomb = gzipSync(Buffer.alloc(16 * 1024 * 1024));
    expect(() =>
      store.createJob(project.id, {
        filename: 'bomb.json',
        adapter: 'fixture',
        content: bomb.toString('base64'),
        encoding: 'gzip+base64',
        collectedAt: null,
        retainRaw: false,
      }),
    ).toThrow(ParseLimitError);
  });

  it('accepts a legitimately gzipped fixture file', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const job = await uploadFixture(app, project.id, {
      content: gzipSync(Buffer.from(FIXTURE_FILE, 'utf8')).toString('base64'),
      encoding: 'gzip+base64',
    });
    await app.importStore.whenIdle();
    const detail = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/imports/${job.id}` })
      .then((r) => r.json());
    expect(detail.job.status).toBe('review');
    // hashing happened over the decompressed evidence bytes
    expect(detail.evidence[0].sha256).toBe(
      createHash('sha256').update(FIXTURE_FILE, 'utf8').digest('hex'),
    );
  });

  it('fails a job whose JSON exceeds the depth limit, without crashing', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const deep = '['.repeat(100) + ']'.repeat(100);
    const job = await uploadFixture(app, project.id, { content: deep });
    await app.importStore.whenIdle();
    const detail = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/imports/${job.id}` })
      .then((r) => r.json());
    expect(detail.job.status).toBe('failed');
    expect(detail.job.error).toMatch(/depth/i);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('checkJsonDepth handles a very deep document iteratively', () => {
    let node: unknown = 1;
    for (let i = 0; i < 200_000; i++) node = [node];
    expect(() => checkJsonDepth(node, DEFAULT_PARSE_LIMITS)).toThrow(ParseLimitError);
  });

  it('over-limit upload via the API returns 413 and the app stays up', async () => {
    const app = await buildApp({ dbFile: ':memory:', logger: false });
    const project = await createProject(app);
    // default limit is 64MB; fastify's own body cap would trip first, so use gzip
    const big = gzipSync(Buffer.alloc(80 * 1024 * 1024, 120));
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports`,
      payload: {
        filename: 'big.json',
        adapter: 'fixture',
        content: big.toString('base64'),
        encoding: 'gzip+base64',
      },
    });
    expect(res.statusCode).toBe(413);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('M1: bundle evidence subtree (ADR-0016/0019)', () => {
  it('round-trips evidence + manifest through export and import', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const job = await uploadFixture(app, project.id);
    await app.importStore.whenIdle();

    const bundle: NetplanBundle = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/export` })
      .then((r) => r.json());
    expect(bundle.evidence).toHaveLength(1);
    expect(bundle.importJobs).toHaveLength(1);
    expect(bundle.manifest.files).toHaveLength(1);
    expect(bundle.manifest.files[0]?.sha256).toBe(bundle.evidence[0]?.record.sha256);

    // restore into a fresh app
    const app2 = await createApp();
    const imported = await app2.inject({
      method: 'POST',
      url: '/projects/import',
      payload: bundle,
    });
    expect(imported.statusCode).toBe(201);

    const detail = await app2
      .inject({ method: 'GET', url: `/projects/${project.id}/imports/${job.id}` })
      .then((r) => r.json());
    expect(detail.job.status).toBe('review');
    expect(detail.evidence[0].sha256).toBe(bundle.evidence[0]?.record.sha256);

    const blob = await app2
      .inject({
        method: 'GET',
        url: `/projects/${project.id}/evidence/${bundle.evidence[0]?.record.id}`,
      })
      .then((r) => r.json());
    expect(blob.content).toBe(FIXTURE_FILE);
  });

  it('rejects a bundle whose evidence content was tampered with', async () => {
    const app = await createApp();
    const project = await createProject(app);
    await uploadFixture(app, project.id);
    await app.importStore.whenIdle();
    const bundle = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/export` })
      .then((r) => r.json());
    bundle.evidence[0].content = bundle.evidence[0].content.replace('web01', 'evil1');

    const app2 = await createApp();
    const res = await app2.inject({ method: 'POST', url: '/projects/import', payload: bundle });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/manifest hash/);
    // the tampered bundle left no partial project behind
    expect((await app2.inject({ method: 'GET', url: '/projects' })).json()).toHaveLength(0);
  });
});
