import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEVICE_STATE_SCHEMA_VERSION } from '@netplan/import-contract';
import { projectStateSchema } from '@netplan/domain';
import { buildApp } from '../src/app.js';

/**
 * #110 C2: commit-time secret scanning is scoped to the committed job's
 * Evidence and batches all detections into ONE ChangeSet — one activity-log
 * unit, one undo step — still fully on the operation log (ADR-0010).
 */

const FAKE_KEY_A = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Q',
  '-----END RSA PRIVATE KEY-----',
].join('\\n');
const FAKE_KEY_B = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIBOgIBAAJBAZzQQtNplvvMrX8NlqrmqLXOOOVeVeUCVy9PqrjNjW4t2LqQu7z',
  '-----END RSA PRIVATE KEY-----',
].join('\\n');

function host(deviceId: string, hostname: string) {
  return {
    deviceId,
    hostname,
    os: { name: 'Linux' },
    collectedAt: '2026-07-15T00:00:00.000Z',
    interfaces: [{ name: 'eth0', addresses: [{ value: '10.0.0.9', kind: 'ipv4' }] }],
    routes: [],
    arp: [],
    connections: [],
    listeningPorts: [],
    localUsers: [],
    localGroups: [],
    administrators: [],
    sudoers: [],
    collection: { scope: ['interfaces'], errors: [] },
  };
}

function report(hosts: ReturnType<typeof host>[]): string {
  return JSON.stringify({ schemaVersion: DEVICE_STATE_SCHEMA_VERSION, hosts });
}

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance): Promise<string> {
  const { id } = await app
    .inject({ method: 'POST', url: '/projects', payload: { name: 'C2' } })
    .then((r) => r.json());
  return id;
}

async function importJob(app: FastifyInstance, id: string, content: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${id}/imports`,
    payload: { filename: 'ev.json', adapter: 'device-state', content },
  });
  const job = res.json();
  await app.importStore.whenIdle();
  return job.id;
}

async function commit(app: FastifyInstance, id: string, jobId: string): Promise<void> {
  const detail = await app
    .inject({ method: 'GET', url: `/projects/${id}/imports/${jobId}` })
    .then((r) => r.json());
  for (const conflict of detail.proposal?.conflicts ?? []) {
    await app.inject({
      method: 'POST',
      url: `/projects/${id}/imports/${jobId}/resolve`,
      payload: { conflictId: conflict.id, action: 'merge' },
    });
  }
  await app.inject({ method: 'POST', url: `/projects/${id}/imports/${jobId}/commit` });
}

async function getState(app: FastifyInstance, id: string) {
  return projectStateSchema.parse(
    (await app.inject({ method: 'GET', url: `/projects/${id}/graph` })).json(),
  );
}

describe('secret scan batching & scoping (#110 C2)', () => {
  it('a commit detecting N secrets lands them as one ChangeSet and one undo unit', async () => {
    const app = await createApp();
    const id = await createProject(app);
    const jobId = await importJob(
      app,
      id,
      report([host('guid-a', `host-a ${FAKE_KEY_A}`), host('guid-b', `host-b ${FAKE_KEY_B}`)]),
    );
    await commit(app, id, jobId);

    const state = await getState(app, id);
    expect(state.secretMatches.length).toBeGreaterThanOrEqual(2);

    const log: { entityType?: string; changeSetId: string | null; payload?: unknown }[] = (
      await app.inject({ method: 'GET', url: `/projects/${id}/log` })
    ).json();
    const secretRows = log.filter((row) => JSON.stringify(row).includes('secretMatch'));
    expect(secretRows.length).toBe(state.secretMatches.length);
    const changeSetIds = new Set(secretRows.map((row) => row.changeSetId));
    expect(changeSetIds.size).toBe(1);
    expect([...changeSetIds][0]).not.toBeNull();

    // one undo reverses the whole detection
    await app.inject({ method: 'POST', url: `/projects/${id}/undo` });
    expect((await getState(app, id)).secretMatches).toHaveLength(0);
  });

  it('re-committing produces no duplicate secrets', async () => {
    const app = await createApp();
    const id = await createProject(app);
    const jobId = await importJob(app, id, report([host('guid-a', `host-a ${FAKE_KEY_A}`)]));
    await commit(app, id, jobId);
    const first = (await getState(app, id)).secretMatches.length;
    expect(first).toBeGreaterThanOrEqual(1);

    // a direct unscoped re-scan (worst case) finds nothing new
    expect(app.importStore.scanEvidenceSecrets(id)).toBe(0);
    expect((await getState(app, id)).secretMatches.length).toBe(first);
  });

  it('a scoped scan touches only the named job’s evidence', async () => {
    const app = await createApp();
    const id = await createProject(app);
    const job1 = await importJob(app, id, report([host('guid-a', `host-a ${FAKE_KEY_A}`)]));
    const job2 = await importJob(app, id, report([host('guid-b', `host-b ${FAKE_KEY_B}`)]));

    const created = app.importStore.scanEvidenceSecrets(id, job2);
    expect(created).toBeGreaterThanOrEqual(1);

    const state = await getState(app, id);
    const job2Evidence = new Set(
      (
        await app
          .inject({ method: 'GET', url: `/projects/${id}/imports/${job2}` })
          .then((r) => r.json())
      ).evidence.map((e: { id: string }) => e.id),
    );
    // every detection came from job2's evidence; job1's blobs were not decoded
    expect(state.secretMatches.length).toBe(created);
    for (const match of state.secretMatches) {
      expect(job2Evidence.has(match.evidenceId)).toBe(true);
    }
    void job1;
  });
});
