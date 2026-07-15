import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEVICE_STATE_SCHEMA_VERSION } from '@netplan/import-contract';
import { newId, operationIdSchema } from '@netplan/domain';
import type { FindingsReport } from '../src/findings/analysis-service.js';
import { buildApp } from '../src/app.js';

/**
 * M11 server DoD: importing device-state evidence makes findings appear on the
 * next read (detection is a pure recompute — no manual run), including the
 * M5/M6 families that need host-security telemetry resolved to committed Devices.
 */

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

function host(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 'machine-guid-ws01',
    hostname: 'ws01',
    os: { name: 'Windows 11' },
    collectedAt: '2026-07-15T00:00:00.000Z',
    interfaces: [{ name: 'eth0', addresses: [{ value: '10.0.0.10', kind: 'ipv4' }] }],
    routes: [],
    arp: [],
    connections: [],
    listeningPorts: [{ protocol: 'tcp', port: 3389, process: 'TermService' }],
    localUsers: [{ name: 'alice' }],
    localGroups: [],
    administrators: [],
    sudoers: [],
    collection: { scope: ['interfaces', 'listeningPorts'], errors: [] },
    remoteAccess: [{ name: 'AnyDesk' }],
    fileInventory: [{ path: 'C:\\Users\\alice\\Downloads\\invoice.pdf.exe' }],
    ...overrides,
  };
}

async function importAndCommit(app: FastifyInstance, projectId: string) {
  const report = { schemaVersion: DEVICE_STATE_SCHEMA_VERSION, hosts: [host()] };
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/imports`,
    payload: { filename: 'ws01.json', adapter: 'device-state', content: JSON.stringify(report) },
  });
  expect(res.statusCode).toBe(202);
  const job = res.json();
  await app.importStore.whenIdle();
  const commit = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/imports/${job.id}/commit`,
  });
  expect(commit.statusCode).toBe(200);
}

async function getFindings(app: FastifyInstance, projectId: string): Promise<FindingsReport> {
  return app
    .inject({ method: 'GET', url: `/projects/${projectId}/findings` })
    .then((r) => r.json());
}

describe('M11 findings service (end-to-end)', () => {
  it('surfaces findings after a device-state import, including M5/M6 host-inventory families', async () => {
    const app = await createApp();
    const { id } = await app
      .inject({ method: 'POST', url: '/projects', payload: { name: 'Findings' } })
      .then((r) => r.json());
    await importAndCommit(app, id);

    const report = await getFindings(app, id);
    const categories = report.findings.map((f) => f.detection?.category);

    // M6: AnyDesk is remote-access software not on the (empty) approved list.
    expect(categories).toContain('unapproved remote-access software');
    // M5: invoice.pdf.exe is a double-extension executable from Downloads.
    expect(categories).toContain('masquerading or double-extension');
    // M7: RDP (3389) is an exposed management service.
    expect(categories).toContain('high-risk exposed management service');
    // Every finding starts as `new` and is not stale.
    expect(report.findings.every((f) => f.status === 'new' && !f.stale)).toBe(true);
    // The run stamped an op-log watermark.
    expect(report.opSeq).toBeGreaterThan(0);
  });

  it('a disposition through the Operation log survives re-analysis', async () => {
    const app = await createApp();
    const { id } = await app
      .inject({ method: 'POST', url: '/projects', payload: { name: 'Findings' } })
      .then((r) => r.json());
    await importAndCommit(app, id);

    const before = await getFindings(app, id);
    const target = before.findings.find(
      (f) => f.detection?.category === 'unapproved remote-access software',
    );
    expect(target).toBeDefined();

    const op = await app.inject({
      method: 'POST',
      url: `/projects/${id}/operations`,
      payload: {
        id: newId(operationIdSchema),
        projectId: id,
        kind: 'SetFindingStatus',
        fingerprint: target!.fingerprint,
        status: 'falsePositive',
        previousStatus: 'new',
      },
    });
    expect(op.statusCode).toBe(200);

    const after = await getFindings(app, id);
    const same = after.findings.find((f) => f.fingerprint === target!.fingerprint);
    expect(same?.status).toBe('falsePositive');
  });

  it('reports per-device coverage so incomplete collection is visible', async () => {
    const app = await createApp();
    const { id } = await app
      .inject({ method: 'POST', url: '/projects', payload: { name: 'Findings' } })
      .then((r) => r.json());
    await importAndCommit(app, id);

    const report = await getFindings(app, id);
    expect(report.coverage.length).toBeGreaterThan(0);
    const ws01 = report.coverage.find((c) => c.deviceName === 'ws01');
    expect(ws01?.available).toContain('fileInventory');
  });
});
