import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEVICE_STATE_SCHEMA_VERSION } from '@netplan/import-contract';
import { projectStateSchema } from '@netplan/domain';
import { buildApp } from '../src/app.js';

/**
 * Improvements M13 (#70): secrets masking, export audit, retention & secure
 * deletion (§3.13).
 */

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance): Promise<string> {
  const { id } = await app
    .inject({ method: 'POST', url: '/projects', payload: { name: 'M13' } })
    .then((r) => r.json());
  return id;
}

async function getState(app: FastifyInstance, id: string) {
  return projectStateSchema.parse(
    (await app.inject({ method: 'GET', url: `/projects/${id}/graph` })).json(),
  );
}

const FAKE_KEY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Q',
  '-----END RSA PRIVATE KEY-----',
].join('\\n');

/** A device-state report whose notes carry a fake private key. */
const REPORT = JSON.stringify({
  schemaVersion: DEVICE_STATE_SCHEMA_VERSION,
  hosts: [
    {
      deviceId: 'guid-secret-01',
      hostname: `web-secret ${FAKE_KEY}`,
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
    },
  ],
});

async function importAndCommit(app: FastifyInstance, id: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${id}/imports`,
    payload: { filename: 'ev.json', adapter: 'device-state', content: REPORT },
  });
  const job = res.json();
  await app.importStore.whenIdle();
  const detail = await app
    .inject({ method: 'GET', url: `/projects/${id}/imports/${job.id}` })
    .then((r) => r.json());
  for (const conflict of detail.proposal?.conflicts ?? []) {
    await app.inject({
      method: 'POST',
      url: `/projects/${id}/imports/${job.id}/resolve`,
      payload: { conflictId: conflict.id, action: 'merge' },
    });
  }
  await app.inject({ method: 'POST', url: `/projects/${id}/imports/${job.id}/commit` });
  return job.id;
}

describe('M13 privacy & audit (#70)', () => {
  it('a committed private key is stored masked and absent from the default report', async () => {
    const app = await createApp();
    const id = await createProject(app);
    await importAndCommit(app, id);

    const state = await getState(app, id);
    const secret = state.secretMatches.find((s) => s.kind === 'privateKey');
    expect(secret).toBeDefined();
    expect(secret?.revealed).toBe(false);
    expect(secret?.masked).toContain('[redacted]');
    // the raw key never persists in the entity
    expect(JSON.stringify(state.secretMatches)).not.toContain('MIIBOgIBAAJBAKj');

    // the default design report is masked
    const report = await app.inject({ method: 'GET', url: `/projects/${id}/report` });
    expect(report.body).not.toContain('MIIBOgIBAAJBAKj');
  });

  it('reveal returns the original once and is audited', async () => {
    const app = await createApp();
    const id = await createProject(app);
    await importAndCommit(app, id);
    const secret = (await getState(app, id)).secretMatches.find((s) => s.kind === 'privateKey');
    if (!secret) throw new Error('no secret detected');

    const reveal = await app.inject({
      method: 'POST',
      url: `/projects/${id}/secrets/${secret.id}/reveal`,
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json().value).toContain('MIIBOgIBAAJBAKj');

    const state = await getState(app, id);
    expect(state.secretMatches.find((s) => s.id === secret.id)?.revealed).toBe(true);
    expect(state.reports.some((r) => r.type === 'secretReveal')).toBe(true);
  });

  it('exports appear in the audit trail (Report records)', async () => {
    const app = await createApp();
    const id = await createProject(app);
    await app.inject({ method: 'GET', url: `/projects/${id}/export` });
    const state = await getState(app, id);
    expect(state.reports.some((r) => r.type === 'bundle')).toBe(true);
  });

  it('purge downgrades evidence to hashOnly, keeps the manifest hash, and audits it', async () => {
    const app = await createApp();
    const id = await createProject(app);
    await importAndCommit(app, id);

    const [evidence] = app.importStore.listEvidence(id);
    expect(evidence).toBeDefined();
    const hashBefore = evidence!.sha256;

    // purge needs explicit confirmation (non-undoable)
    const noConfirm = await app.inject({
      method: 'POST',
      url: `/projects/${id}/evidence/${evidence!.id}/purge`,
      payload: {},
    });
    expect(noConfirm.statusCode).toBe(400);

    const purge = await app.inject({
      method: 'POST',
      url: `/projects/${id}/evidence/${evidence!.id}/purge`,
      payload: { confirm: true },
    });
    expect(purge.statusCode).toBe(200);

    const after = app.importStore.listEvidence(id)[0]!;
    expect(after.retention).toBe('hashOnly');
    expect(after.sha256).toBe(hashBefore); // identity survives
    // the raw blob is gone
    const blob = await app.inject({
      method: 'GET',
      url: `/projects/${id}/evidence/${evidence!.id}`,
    });
    expect(blob.statusCode).toBe(404);
    // audited
    expect((await getState(app, id)).reports.some((r) => r.type === 'evidencePurge')).toBe(true);

    // revealing a secret whose source was purged is refused
    const secret = (await getState(app, id)).secretMatches[0];
    if (secret) {
      const reveal = await app.inject({
        method: 'POST',
        url: `/projects/${id}/secrets/${secret.id}/reveal`,
      });
      expect(reveal.statusCode).toBe(409);
    }
  });

  it('the retention sweep downgrades old raw evidence and audits the sweep', async () => {
    const app = await createApp();
    const id = await createProject(app);
    await importAndCommit(app, id);

    // maxAgeDays 0 → everything is older than the cutoff
    const sweep = await app.inject({
      method: 'POST',
      url: `/projects/${id}/retention/sweep`,
      payload: { maxAgeDays: 0 },
    });
    expect(sweep.statusCode).toBe(200);
    expect(sweep.json().purged).toBeGreaterThan(0);
    expect(app.importStore.listEvidence(id).every((e) => e.retention === 'hashOnly')).toBe(true);
    expect((await getState(app, id)).reports.some((r) => r.type === 'retentionSweep')).toBe(true);
  });
});
