import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEVICE_STATE_SCHEMA_VERSION } from '@netplan/import-contract';
import type { ImportJob, ImportProposal, Observation, ProjectState } from '@netplan/domain';
import { buildApp } from '../src/app.js';
import { parsePrincipal } from '../src/imports/adapters/device-state.js';

/** M4 DoD: 3 hosts through the M1–M3 pipeline; DOMAIN\admin → domain Identity. */

const SAMPLE = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'packages',
    'import-contract',
    'test',
    'fixtures',
    'sample-report.json',
  ),
  'utf8',
);

async function importSample(app: FastifyInstance, projectId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/imports`,
    payload: { filename: 'device-state.json', adapter: 'device-state', content: SAMPLE },
  });
  expect(res.statusCode).toBe(202);
  const job: ImportJob = res.json();
  await app.importStore.whenIdle();
  const detail: { job: ImportJob; observations: Observation[]; proposal: ImportProposal | null } =
    await app
      .inject({ method: 'GET', url: `/projects/${projectId}/imports/${job.id}` })
      .then((r) => r.json());
  return detail;
}

describe('M4: device-state import end to end', () => {
  it('parses principals per ADR-0022', () => {
    expect(parsePrincipal('CORP\\alice')).toEqual({
      scope: 'domain',
      domain: 'CORP',
      name: 'alice',
    });
    expect(parsePrincipal('alice@corp.example')).toEqual({
      scope: 'domain',
      domain: 'corp.example',
      name: 'alice',
    });
    expect(parsePrincipal('ubuntu')).toEqual({ scope: 'local', domain: '', name: 'ubuntu' });
  });

  it('a 3-host report yields devices, interfaces, services and identities through the pipeline', async () => {
    const app = await buildApp({ dbFile: ':memory:', logger: false });
    const project = await app
      .inject({ method: 'POST', url: '/projects', payload: { name: 'P' } })
      .then((r) => r.json());

    const detail = await importSample(app, project.id);
    expect(detail.job.status).toBe('review');
    // the ImportJob records the contract version (ADR-0018)
    expect(detail.job.schemaVersion).toBe(DEVICE_STATE_SCHEMA_VERSION);
    expect(detail.proposal!.conflicts).toEqual([]);

    const commit = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${detail.job.id}/commit`,
    });
    expect(commit.statusCode).toBe(200);
    const state: ProjectState = commit.json().state;

    expect(state.devices).toHaveLength(3);
    expect(state.devices.map((d) => d.name).sort()).toEqual(['WS-FINANCE-07', 'db01', 'web01']);
    const web01 = state.devices.find((d) => d.name === 'web01')!;
    expect(web01.os).toBe('Ubuntu Server 24.04');
    expect(web01.deviceType).toBe('server');
    expect(web01.lifecycleState).toBe('observed');

    // interfaces + addresses (MAC and IPs) landed under the right host
    const web01Ifaces = state.interfaces.filter((i) => i.deviceId === web01.id);
    expect(web01Ifaces.map((i) => i.name)).toEqual(['eth0']);
    const web01Addresses = state.addresses.filter((a) => a.interfaceId === web01Ifaces[0]!.id);
    expect(web01Addresses.map((a) => a.kind).sort()).toEqual(['ipv4', 'ipv6', 'mac']);

    // listening ports became Services with owning process
    const web01Services = state.services.filter((s) => s.deviceId === web01.id);
    expect(web01Services.map((s) => `${s.protocol}/${s.portStart}:${s.process}`).sort()).toEqual([
      'tcp/22:sshd',
      'tcp/443:nginx',
    ]);

    // active connections became aggregated flows between known devices
    const db01 = state.devices.find((d) => d.name === 'db01')!;
    const dbFlow = state.flows.find((f) => f.port === 5432);
    expect(dbFlow).toBeDefined();
    expect(dbFlow!.source).toEqual({ kind: 'device', id: web01.id });
    expect(dbFlow!.destination).toEqual({ kind: 'device', id: db01.id });
    // ...and linked to the postgres Service on the destination
    const postgres = state.services.find((s) => s.deviceId === db01.id && s.portStart === 5432);
    expect(dbFlow!.serviceId).toBe(postgres!.id);

    // identities: locals stay per-host; CORP\alice is ONE domain-scoped
    // identity carrying role assignments on two hosts (ADR-0022)
    const alice = state.identities.filter((i) => i.name === 'alice' && i.scope === 'domain');
    expect(alice).toHaveLength(1);
    expect(alice[0]!.domain).toBe('CORP');
    expect(alice[0]!.deviceId).toBeNull();
    const aliceRoles = state.roleAssignments.filter((r) => r.identityId === alice[0]!.id);
    const ws = state.devices.find((d) => d.name === 'WS-FINANCE-07')!;
    expect(
      aliceRoles.some((r) => r.privilege === 'localAdministrator' && r.deviceId === ws.id),
    ).toBe(true);
    expect(aliceRoles.some((r) => r.privilege === 'sudoer' && r.deviceId === web01.id)).toBe(true);

    const locals = state.identities.filter((i) => i.scope === 'local');
    expect(locals.some((i) => i.name === 'ubuntu' && i.deviceId === web01.id)).toBe(true);
    expect(locals.some((i) => i.name === 'postgres' && i.deviceId === db01.id)).toBe(true);
  });

  it('rejects a non-conformant report as a failed job, not a crash', async () => {
    const app = await buildApp({ dbFile: ':memory:', logger: false });
    const project = await app
      .inject({ method: 'POST', url: '/projects', payload: { name: 'P' } })
      .then((r) => r.json());
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports`,
      payload: {
        filename: 'bad.json',
        adapter: 'device-state',
        content: JSON.stringify({ schemaVersion: '1.0.0', hosts: [{ hostname: 'x' }] }),
      },
    });
    const job: ImportJob = res.json();
    await app.importStore.whenIdle();
    const detail = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/imports/${job.id}` })
      .then((r) => r.json());
    expect(detail.job.status).toBe('failed');
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
