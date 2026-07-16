import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEVICE_STATE_SCHEMA_VERSION } from '@netplan/import-contract';
import { projectStateSchema } from '@netplan/domain';
import type { FindingsReport } from '../src/findings/analysis-service.js';
import { buildApp } from '../src/app.js';

/**
 * Improvements M7 (#64): the §3.8 detection inputs are pipeline-written
 * hostArtifact entities — imported through normalize → dedupe → propose →
 * commit, carried on ProjectState, provenance-tracked, and consumed by the
 * filename-path and process-persistence rule families. Analysis keeps working
 * after raw evidence disappears, because it reads state, not blobs.
 */

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

const REPORT = {
  schemaVersion: DEVICE_STATE_SCHEMA_VERSION,
  hosts: [
    {
      deviceId: 'machine-guid-m7',
      hostname: 'ws-m7',
      os: { name: 'Windows 11' },
      collectedAt: '2026-07-15T00:00:00.000Z',
      interfaces: [{ name: 'eth0', addresses: [{ value: '10.7.0.10', kind: 'ipv4' }] }],
      routes: [],
      arp: [],
      connections: [],
      listeningPorts: [{ protocol: 'tcp', port: 443, process: 'nginx' }],
      localUsers: [{ name: 'op' }],
      localGroups: [],
      administrators: [],
      sudoers: [],
      collection: { scope: ['interfaces', 'listeningPorts'], errors: [] },
      processes: [
        { name: 'svchost.exe', path: 'C:\\Users\\op\\AppData\\Local\\Temp\\svchost.exe' },
      ],
      startupEntries: [{ name: 'Updater', command: 'C:\\Users\\op\\updater.exe' }],
      scheduledTasks: [{ name: 'Nightly', command: 'powershell -enc AAA' }],
      packages: [{ name: 'LibreOffice', publisher: 'TDF', version: '24.8' }],
      remoteAccess: [{ name: 'AnyDesk' }],
      fileInventory: [
        { path: 'C:\\Users\\op\\Downloads\\invoice.pdf.exe', sha256: 'ab'.repeat(32) },
      ],
    },
  ],
};

async function importAndCommit(app: FastifyInstance, projectId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/imports`,
    payload: {
      filename: 'ws-m7.json',
      adapter: 'device-state',
      content: JSON.stringify(REPORT),
    },
  });
  expect(res.statusCode).toBe(202);
  const job = res.json();
  await app.importStore.whenIdle();
  const commit = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/imports/${job.id}/commit`,
  });
  expect(commit.statusCode).toBe(200);
  return job.id as string;
}

async function getState(app: FastifyInstance, projectId: string) {
  const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/graph` });
  return projectStateSchema.parse(res.json());
}

describe('M7 host artifacts (detection-input ingestion, #64)', () => {
  it('a committed device-state import persists typed hostArtifacts keyed to the Device', async () => {
    const app = await createApp();
    const { id } = await app
      .inject({ method: 'POST', url: '/projects', payload: { name: 'M7' } })
      .then((r) => r.json());
    await importAndCommit(app, id);

    const state = await getState(app, id);
    const device = state.devices.find((d) => d.name === 'ws-m7');
    expect(device).toBeDefined();
    const artifacts = state.hostArtifacts.filter((a) => a.deviceId === device?.id);

    expect(artifacts.filter((a) => a.kind === 'process')).toHaveLength(1);
    // startup + scheduled task = two persistence entries
    expect(artifacts.filter((a) => a.kind === 'persistence')).toHaveLength(2);
    // one package + one remote-access tool
    const software = artifacts.filter((a) => a.kind === 'software');
    expect(software).toHaveLength(2);
    expect(software.find((s) => s.name === 'AnyDesk')?.remoteAccess).toBe(true);
    const file = artifacts.find((a) => a.kind === 'file');
    expect(file?.path).toBe('C:\\Users\\op\\Downloads\\invoice.pdf.exe');
    expect(file?.sha256).toBe('ab'.repeat(32));
    for (const artifact of artifacts) {
      expect(artifact.lifecycleState).toBe('observed');
      expect(artifact.confidence).toBeGreaterThan(0);
    }
  });

  it('re-importing the same report does not duplicate artifacts after a merge', async () => {
    const app = await createApp();
    const { id } = await app
      .inject({ method: 'POST', url: '/projects', payload: { name: 'M7-dedupe' } })
      .then((r) => r.json());
    await importAndCommit(app, id);
    const before = (await getState(app, id)).hostArtifacts.length;

    // second import of the identical report → device conflict → merge
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${id}/imports`,
      payload: {
        filename: 'ws-m7-again.json',
        adapter: 'device-state',
        content: JSON.stringify(REPORT),
      },
    });
    const job = res.json();
    await app.importStore.whenIdle();
    const detail = await app
      .inject({ method: 'GET', url: `/projects/${id}/imports/${job.id}` })
      .then((r) => r.json());
    const conflicts: { id: string; entityType: string }[] = detail.proposal.conflicts;
    expect(conflicts.some((c) => c.entityType === 'device')).toBe(true);
    for (const conflict of conflicts) {
      const resolved = await app.inject({
        method: 'POST',
        url: `/projects/${id}/imports/${job.id}/resolve`,
        payload: { conflictId: conflict.id, action: 'merge' },
      });
      expect(resolved.statusCode).toBe(200);
    }
    const commit = await app.inject({
      method: 'POST',
      url: `/projects/${id}/imports/${job.id}/commit`,
    });
    expect(commit.statusCode).toBe(200);

    const after = (await getState(app, id)).hostArtifacts.length;
    expect(after).toBe(before);
  });

  it('filename-path and process-persistence families fire and coverage reports the classes', async () => {
    const app = await createApp();
    const { id } = await app
      .inject({ method: 'POST', url: '/projects', payload: { name: 'M7-rules' } })
      .then((r) => r.json());
    await importAndCommit(app, id);

    const report: FindingsReport = await app
      .inject({ method: 'GET', url: `/projects/${id}/findings` })
      .then((r) => r.json());

    const ruleIds = new Set(
      report.findings.map((f) => f.detection?.ruleId).filter((r): r is string => !!r),
    );
    // the filename-path family (double-extension download) and the
    // process/persistence family must both fire end-to-end
    expect([...ruleIds].some((r) => r.startsWith('file.'))).toBe(true);
    expect([...ruleIds].some((r) => r.startsWith('process.') || r.startsWith('persistence.'))).toBe(
      true,
    );

    const coverage = report.coverage.find((c) => c.deviceName === 'ws-m7');
    expect(coverage).toBeDefined();
    for (const cls of ['processes', 'persistence', 'installedSoftware', 'fileInventory']) {
      expect(coverage?.available).toContain(cls);
      expect(coverage?.missing).not.toContain(cls);
    }
  });
});
