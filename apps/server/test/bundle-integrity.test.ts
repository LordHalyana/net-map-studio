import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeBundle, newId, projectIdSchema, type ProjectState } from '@netplan/domain';
import { makeEvidence, makeImportJob, makeProject } from '@netplan/domain/fixtures';
import { buildApp } from '../src/app.js';

/**
 * #110 C3: bundle import is all-or-nothing and restored rows must belong to
 * the imported project; graceful close checkpoints and releases SQLite.
 */

async function createApp(dbFile = ':memory:'): Promise<FastifyInstance> {
  return buildApp({ dbFile, logger: false });
}

function emptyState(projectId?: string): ProjectState {
  const project = makeProject(projectId ? { id: projectIdSchema.parse(projectId) } : {});
  return {
    project,
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

const EXPORTED_AT = '2026-07-18T00:00:00.000Z';

describe('.netplan bundle integrity (#110 C3)', () => {
  it('rejects a bundle whose evidence row targets a different project, injecting nothing', async () => {
    const app = await createApp();
    // the victim project a crafted bundle tries to inject into
    const victim = (
      await app.inject({ method: 'POST', url: '/projects', payload: { name: 'victim' } })
    ).json();

    const state = emptyState();
    const foreignJob = makeImportJob(projectIdSchema.parse(victim.id));
    const foreignEvidence = makeEvidence(foreignJob);
    const bundle = makeBundle(state, EXPORTED_AT, {
      importJobs: [foreignJob],
      evidence: [{ record: foreignEvidence, encoding: 'utf8', content: null }],
    });

    const res = await app.inject({ method: 'POST', url: '/projects/import', payload: bundle });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('different project');

    // nothing landed: neither the new project nor rows in the victim
    const graph = await app.inject({ method: 'GET', url: `/projects/${state.project.id}/graph` });
    expect(graph.statusCode).toBe(404);
    const victimJobs = (
      await app.inject({ method: 'GET', url: `/projects/${victim.id}/imports` })
    ).json();
    expect(victimJobs).toHaveLength(0);
  });

  it('a failure during attachment restore leaves no partial project', async () => {
    const app = await createApp();
    const state = emptyState();
    const job = makeImportJob(state.project.id);
    const evidence = makeEvidence(job);
    // duplicate evidence ids: the second insert violates the primary key
    // AFTER the project state and first row were written in the transaction
    const bundle = makeBundle(state, EXPORTED_AT, {
      importJobs: [job],
      evidence: [
        { record: evidence, encoding: 'utf8', content: null },
        { record: evidence, encoding: 'utf8', content: null },
      ],
    });

    const res = await app.inject({ method: 'POST', url: '/projects/import', payload: bundle });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const graph = await app.inject({ method: 'GET', url: `/projects/${state.project.id}/graph` });
    expect(graph.statusCode).toBe(404);
  });

  it('a valid bundle with evidence still round-trips', async () => {
    const app = await createApp();
    const state = emptyState();
    const job = makeImportJob(state.project.id);
    const evidence = makeEvidence(job);
    const bundle = makeBundle(state, EXPORTED_AT, {
      importJobs: [job],
      evidence: [{ record: evidence, encoding: 'utf8', content: null }],
    });

    const res = await app.inject({ method: 'POST', url: '/projects/import', payload: bundle });
    expect(res.statusCode).toBe(201);
    const jobs = (
      await app.inject({ method: 'GET', url: `/projects/${state.project.id}/imports` })
    ).json();
    expect(jobs).toHaveLength(1);
  });
});

describe('graceful close releases SQLite (#110 C3)', () => {
  const dbFile = join(tmpdir(), `netplan-close-test-${newId(projectIdSchema)}.db`);

  afterEach(async () => {
    for (const suffix of ['', '-wal', '-shm']) {
      await rm(`${dbFile}${suffix}`, { force: true });
    }
  });

  it('checkpoints and removes WAL files on app.close()', async () => {
    const app = await createApp(dbFile);
    await app.inject({ method: 'POST', url: '/projects', payload: { name: 'wal' } });
    expect(existsSync(`${dbFile}-wal`)).toBe(true);

    await app.close();
    // last connection closed → WAL checkpointed into the db, sidecars removed
    expect(existsSync(`${dbFile}-wal`)).toBe(false);
    expect(existsSync(`${dbFile}-shm`)).toBe(false);
    expect(existsSync(dbFile)).toBe(true);
  });
});
