import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CONFIDENCE_CONTRIBUTOR_SCORES,
  type FieldProvenance,
  type ImportJob,
  type ImportProposal,
  type Observation,
  type ProjectState,
} from '@netplan/domain';
import { buildApp } from '../src/app.js';

/** M5 DoD: a second source corroborates, MAC scores strong, OS guess lower,
 * and a conflicting hostname enters the reconciliation queue. */

const NMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" args="nmap -O -sV 10.0.0.0/24" start="1783500000" version="7.95">
  <host starttime="1783500010" endtime="1783500042">
    <status state="up" reason="arp-response"/>
    <address addr="10.0.0.10" addrtype="ipv4"/>
    <address addr="AA:BB:CC:00:00:01" addrtype="mac" vendor="Dell Inc."/>
    <hostnames><hostname name="web01.corp.example" type="PTR"/></hostnames>
    <ports>
      <port protocol="tcp" portid="443">
        <state state="open" reason="syn-ack"/>
        <service name="https" product="nginx" version="1.24.0" method="probed" conf="10"/>
        <script id="http-title" output="Welcome"/>
      </port>
      <port protocol="tcp" portid="8080">
        <state state="closed" reason="reset"/>
      </port>
    </ports>
    <os><osmatch name="Linux 5.4 - 6.8" accuracy="93"/></os>
  </host>
  <host starttime="1783500010" endtime="1783500050">
    <status state="up" reason="echo-reply"/>
    <address addr="10.0.0.55" addrtype="ipv4"/>
    <ports>
      <port protocol="tcp" portid="9100">
        <state state="open" reason="syn-ack"/>
        <service name="jetdirect"/>
      </port>
    </ports>
  </host>
  <host starttime="1783500010" endtime="1783500051">
    <status state="down" reason="no-response"/>
    <address addr="10.0.0.99" addrtype="ipv4"/>
  </host>
</nmaprun>`;

const DEVICE_STATE = readFileSync(
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

interface Detail {
  job: ImportJob;
  observations: Observation[];
  proposal: ImportProposal | null;
}

async function runImport(
  app: FastifyInstance,
  projectId: string,
  adapter: string,
  filename: string,
  content: string,
): Promise<Detail> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/imports`,
    payload: { filename, adapter, content },
  });
  expect(res.statusCode).toBe(202);
  const job: ImportJob = res.json();
  await app.importStore.whenIdle();
  return app
    .inject({ method: 'GET', url: `/projects/${projectId}/imports/${job.id}` })
    .then((r) => r.json());
}

async function newProject(app: FastifyInstance): Promise<string> {
  const project = await app
    .inject({ method: 'POST', url: '/projects', payload: { name: 'P' } })
    .then((r) => r.json());
  return project.id;
}

describe('M5: Nmap XML adapter', () => {
  it('emits host/address/service/OS observations with §3.7 contributors', async () => {
    const app = await buildApp({ dbFile: ':memory:', logger: false });
    const projectId = await newProject(app);
    const detail = await runImport(app, projectId, 'nmap-xml', 'scan.xml', NMAP_XML);

    expect(detail.job.status).toBe('review');
    const contributors = new Map<string, number>();
    for (const o of detail.observations) {
      contributors.set(o.contributor, (contributors.get(o.contributor) ?? 0) + 1);
    }
    // MAC-identified host claims are strong; the MAC-less printer is scan-window
    expect(contributors.get('exactMacMatch')).toBeGreaterThan(0);
    expect(contributors.get('ipSameScanWindow')).toBeGreaterThan(0);
    // the OS guess is a separate, weaker claim
    const osObs = detail.observations.find((o) => o.contributor === 'osFingerprint')!;
    expect(osObs.claim).toMatchObject({ targetKind: 'device', fields: { os: 'Linux 5.4 - 6.8' } });
    expect(CONFIDENCE_CONTRIBUTOR_SCORES.osFingerprint).toBeLessThan(
      CONFIDENCE_CONTRIBUTOR_SCORES.exactMacMatch,
    );
    // closed ports and down hosts are not observed
    const serviceClaims = detail.observations.filter((o) => o.claim.targetKind === 'service');
    expect(serviceClaims).toHaveLength(2);
    // scan timestamps carried through
    expect(detail.observations[0]!.observedAt).toBe(new Date(1783500042 * 1000).toISOString());
    // two up hosts → two device candidates, none for the down host
    const proposalDevices = detail.proposal!.operations.filter(
      (o) => o.kind === 'CreateEntity' && o.payload.entityType === 'device',
    );
    expect(proposalDevices).toHaveLength(2);
  });

  it('a scan overlapping a device-state host corroborates it after merge — one Device, provenance from both sources', async () => {
    const app = await buildApp({ dbFile: ':memory:', logger: false });
    const projectId = await newProject(app);

    const first = await runImport(app, projectId, 'device-state', 'report.json', DEVICE_STATE);
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports/${first.job.id}/commit`,
    });

    const second = await runImport(app, projectId, 'nmap-xml', 'scan.xml', NMAP_XML);
    // same MAC, but PTR hostname differs from the committed name: this is a
    // conflict in the reconciliation queue, never a silent merge
    const conflict = second.proposal!.conflicts.find((c) => c.entityType === 'device')!;
    expect(conflict).toBeDefined();
    expect(conflict.fieldDiffs.some((d) => d.field === 'name')).toBe(true);
    expect(conflict.resolution).toBe('pending');

    const commitBlocked = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports/${second.job.id}/commit`,
    });
    expect(commitBlocked.statusCode).toBe(409);

    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports/${second.job.id}/resolve`,
      payload: { conflictId: conflict.id, action: 'merge' },
    });
    const commit = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports/${second.job.id}/commit`,
    });
    expect(commit.statusCode).toBe(200);
    const state: ProjectState = commit.json().state;

    // still one web01 (plus db01, WS and the newly discovered printer host)
    const web01Devices = state.devices.filter(
      (d) => d.name === 'web01' || d.name === 'web01.corp.example',
    );
    expect(web01Devices).toHaveLength(1);
    const web01 = web01Devices[0]!;
    // merge semantics: the committed name and OS win; the vendor gap was filled
    expect(web01.name).toBe('web01');
    expect(web01.os).toBe('Ubuntu Server 24.04');
    expect(web01.vendor).toBe('Dell Inc.');

    // provenance from BOTH import jobs on the one device (corroboration)
    const provenance: FieldProvenance[] = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/provenance/device/${web01.id}` })
      .then((r) => r.json());
    const jobs = new Set(provenance.map((r) => r.importJobId));
    expect(jobs).toContain(first.job.id);
    expect(jobs).toContain(second.job.id);
    // the OS guess is retained as a competing (rejected) row, weaker than the accepted one
    const osRows = provenance.filter((r) => r.field === 'os');
    const guess = osRows.find((r) => r.observedValue === 'Linux 5.4 - 6.8')!;
    const accepted = osRows.find((r) => r.status === 'accepted')!;
    expect(guess.status).toBe('rejected');
    expect(guess.confidence).toBeLessThan(accepted.confidence);
  });
});
