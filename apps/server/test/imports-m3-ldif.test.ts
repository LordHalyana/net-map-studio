import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEVICE_STATE_SCHEMA_VERSION } from '@netplan/import-contract';
import type { Identity, Observation } from '@netplan/domain';
import { buildApp } from '../src/app.js';
import type { ImportJobDetail } from '../src/imports/store.js';

/**
 * P4-M3 DoD: importing a fixture LDIF produces Identity Observations that
 * reconcile (merge / keep-separate) through the existing queue, each traceable
 * to the LDIF Evidence; domain principals correlate across sources via
 * Identity.scope (ADR-0022). Hermetic — no egress.
 */

const LDIF_FIXTURE = [
  'version: 1',
  '',
  'dn: CN=Alice Liddell,OU=Users,DC=corp,DC=example,DC=com',
  'objectClass: top',
  'objectClass: person',
  'objectClass: user',
  'cn: Alice Liddell',
  'sAMAccountName: alice',
  '',
  'dn: CN=svc-backup,OU=Service Accounts,DC=corp,DC=example,DC=com',
  'objectClass: top',
  'objectClass: msDS-ManagedServiceAccount',
  'cn: svc-backup',
  'sAMAccountName: svc-backup',
  '',
  'dn: CN=Domain Admins,OU=Groups,DC=corp,DC=example,DC=com',
  'objectClass: top',
  'objectClass: group',
  'cn: Domain Admins',
  'sAMAccountName: Domain Admins',
  '',
  // a computer account: a Device, not a modelled Identity — must be skipped
  'dn: CN=WS01,OU=Computers,DC=corp,DC=example,DC=com',
  'objectClass: top',
  'objectClass: computer',
  'cn: WS01',
  'sAMAccountName: WS01$',
  '',
  // base64-encoded cn with a folded continuation line
  'dn: CN=Bob Builder,OU=Users,DC=corp,DC=example,DC=com',
  'objectClass: person',
  'cn:: Qm9iIEJ1aWxkZXI=',
  'sAMAccountName: bo',
  ' b',
  '',
].join('\n');

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/projects', payload: { name: 'M3' } });
  return res.json().id;
}

async function importFile(
  app: FastifyInstance,
  projectId: string,
  adapter: string,
  filename: string,
  content: string,
): Promise<ImportJobDetail> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/imports`,
    payload: { filename, adapter, content },
  });
  expect(res.statusCode).toBe(202);
  const job = res.json();
  await app.importStore.whenIdle();
  return app
    .inject({ method: 'GET', url: `/projects/${projectId}/imports/${job.id}` })
    .then((r) => r.json());
}

async function commit(app: FastifyInstance, projectId: string, jobId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/imports/${jobId}/commit`,
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('P4-M3: LDIF directory-export adapter', () => {
  it('parses a fixture LDIF into host-less domain identity Observations traceable to the Evidence', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const detail = await importFile(app, projectId, 'ldif', 'export.ldif', LDIF_FIXTURE);

    expect(detail.job.status).toBe('review');
    expect(detail.evidence).toHaveLength(1);
    const evidenceId = detail.evidence[0]?.id;

    // alice (user), svc-backup (serviceAccount), Domain Admins (group), bob
    // (person, base64 + folded name); the computer account is skipped
    const parsedObservations: Observation[] = detail.observations;
    expect(parsedObservations).toHaveLength(4);
    for (const obs of parsedObservations) {
      expect(obs.claim.targetKind).toBe('identity');
      expect(obs.evidenceId).toBe(evidenceId);
      expect(obs.contributor).toBe('directoryExport');
      if (obs.claim.targetKind === 'identity') {
        expect(obs.claim.device).toBeNull();
        expect(obs.claim.identity.scope).toBe('domain');
        expect(obs.claim.identity.domain).toBe('corp');
      }
    }
    const names = detail.observations.map((o: Observation) =>
      o.claim.targetKind === 'identity' ? o.claim.identity.name : '',
    );
    expect(names.sort()).toEqual(['Domain Admins', 'alice', 'bob', 'svc-backup']);
  });

  it('commits to Identity entities: domain-scoped, no host, correct kinds', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const detail = await importFile(app, projectId, 'ldif', 'export.ldif', LDIF_FIXTURE);
    expect(detail.proposal?.conflicts).toEqual([]);
    const committed = await commit(app, projectId, detail.job.id);

    const identities: Identity[] = committed.state.identities;
    expect(identities).toHaveLength(4);
    expect(identities.every((i) => i.scope === 'domain' && i.deviceId === null)).toBe(true);
    // domains are canonicalized upper-case by the pipeline
    expect(identities.every((i) => i.domain === 'CORP')).toBe(true);
    const byName = new Map(identities.map((i) => [i.name, i.kind]));
    expect(byName.get('alice')).toBe('user');
    expect(byName.get('svc-backup')).toBe('serviceAccount');
    expect(byName.get('Domain Admins')).toBe('group');
    // no Device was fabricated for host-less principals or the computer entry
    expect(committed.state.devices).toHaveLength(0);
  });

  it('a directory principal already observed on a host raises a merge conflict and merges (ADR-0022)', async () => {
    const app = await createApp();
    const projectId = await createProject(app);

    // 1) device-state evidence: CORP\alice observed on host ws01
    const report = {
      schemaVersion: DEVICE_STATE_SCHEMA_VERSION,
      hosts: [
        {
          deviceId: 'machine-guid-ws01',
          hostname: 'ws01',
          os: { name: 'Windows 11' },
          collectedAt: '2026-07-15T00:00:00.000Z',
          interfaces: [{ name: 'eth0', addresses: [{ value: '10.0.0.10', kind: 'ipv4' }] }],
          routes: [],
          arp: [],
          connections: [],
          listeningPorts: [],
          localUsers: [],
          localGroups: [],
          administrators: ['CORP\\alice'],
          sudoers: [],
          collection: { scope: ['interfaces', 'administrators'], errors: [] },
        },
      ],
    };
    const first = await importFile(
      app,
      projectId,
      'device-state',
      'ws01.json',
      JSON.stringify(report),
    );
    await commit(app, projectId, first.job.id);

    // 2) the LDIF export names the same principal
    const second = await importFile(app, projectId, 'ldif', 'export.ldif', LDIF_FIXTURE);
    const aliceConflict = second.proposal?.conflicts.find(
      (c) => c.entityType === 'identity' && c.summary.toLowerCase().includes('alice'),
    );
    expect(aliceConflict).toBeDefined();

    // resolve as merge — the queue never auto-merges (Reconciliation)
    const resolve = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports/${second.job.id}/resolve`,
      payload: { conflictId: aliceConflict?.id, action: 'merge' },
    });
    expect(resolve.statusCode).toBe(200);
    const committed = await commit(app, projectId, second.job.id);

    const alices: Identity[] = committed.state.identities.filter(
      (i: Identity) => i.name.toLowerCase() === 'alice',
    );
    expect(alices).toHaveLength(1);
    expect(alices[0]?.scope).toBe('domain');
  });

  it('malformed LDIF fails the job without crashing the app', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const detail = await importFile(
      app,
      projectId,
      'ldif',
      'broken.ldif',
      'objectClass: user\nno dn came first\n',
    );
    expect(detail.job.status).toBe('failed');
    expect(detail.job.error).toContain('Parse failed');
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
  });
});
