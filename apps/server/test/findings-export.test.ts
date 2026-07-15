import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEVICE_STATE_SCHEMA_VERSION } from '@netplan/import-contract';
import { buildApp } from '../src/app.js';

/**
 * M12 DoD (acceptance #8, design §3.12, Q15): a Security Findings report shows
 * severity, confidence, evidence references and verification steps; findings
 * CSV/JSON round-trip through redaction; the client-safe profile masks
 * usernames/hashes/external-IPs/evidence-paths while leaving titles/severity intact.
 */

async function setup(): Promise<{ app: FastifyInstance; id: string }> {
  const app = await buildApp({ dbFile: ':memory:', logger: false });
  const { id } = await app
    .inject({ method: 'POST', url: '/projects', payload: { name: 'Export' } })
    .then((r) => r.json());
  const report = {
    schemaVersion: DEVICE_STATE_SCHEMA_VERSION,
    hosts: [
      {
        deviceId: 'guid-export-01',
        hostname: 'ws-export',
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
        collection: { scope: ['listeningPorts'], errors: [] },
        remoteAccess: [{ name: 'AnyDesk' }],
        fileInventory: [{ path: 'C:\\Users\\alice\\Downloads\\invoice.pdf.exe' }],
      },
    ],
  };
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${id}/imports`,
    payload: { filename: 'e.json', adapter: 'device-state', content: JSON.stringify(report) },
  });
  const job = res.json();
  await app.importStore.whenIdle();
  await app.inject({ method: 'POST', url: `/projects/${id}/imports/${job.id}/commit` });
  return { app, id };
}

describe('M12 Security Findings report, CSV/JSON export & redaction', () => {
  it('the Security Findings report shows severity, confidence, evidence and verification (acceptance #8)', async () => {
    const { app, id } = await setup();
    const res = await app.inject({ method: 'GET', url: `/projects/${id}/report/findings` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.body;
    expect(html).toContain('Security Findings');
    expect(html).toContain('Severity');
    expect(html).toContain('Confidence');
    expect(html).toContain('Verification steps');
    expect(html).toContain('v1.0.0'); // rule version — reproducibility
    expect(html).toContain('computed as of op #');
    expect(html).toContain('unapproved remote-access software');
  });

  it('exports findings as CSV with severity, confidence and rule columns', async () => {
    const { app, id } = await setup();
    const res = await app.inject({ method: 'GET', url: `/projects/${id}/export/csv/findings` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const csv = res.body;
    expect(csv).toContain('severity');
    expect(csv).toContain('ruleVersion');
    expect(csv).toContain('unapproved remote-access software');
  });

  it('the client-safe profile masks evidence paths while keeping the finding kind', async () => {
    const { app, id } = await setup();
    const plain = await app
      .inject({ method: 'GET', url: `/projects/${id}/report/findings` })
      .then((r) => r.body);
    const redacted = await app
      .inject({ method: 'GET', url: `/projects/${id}/report/findings?redact=client-safe` })
      .then((r) => r.body);

    // The raw evidence path is present unredacted, gone when client-safe.
    expect(plain).toContain('Downloads');
    expect(redacted).not.toContain('Downloads');
    expect(redacted).toContain('[path]');
    // The finding kind and severity survive redaction.
    expect(redacted).toContain('masquerading or double-extension');
    expect(redacted).toContain('Severity');
  });

  it('the findings JSON export round-trips through redaction', async () => {
    const { app, id } = await setup();
    const redacted = await app
      .inject({ method: 'GET', url: `/projects/${id}/findings?redact=client-safe` })
      .then((r) => r.json());
    const masquerade = redacted.findings.find(
      (f: { detection: { category: string } | null }) =>
        f.detection?.category === 'masquerading or double-extension',
    );
    expect(masquerade).toBeDefined();
    expect(masquerade.detection.title).not.toContain('Downloads');
  });
});
