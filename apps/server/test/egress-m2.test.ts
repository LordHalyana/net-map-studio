import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEVICE_STATE_SCHEMA_VERSION } from '@netplan/import-contract';
import type { EgressAuditRecord } from '@netplan/domain';
import { buildApp } from '../src/app.js';
import type { EnrichmentView } from '../src/egress/enrichment.js';
import type { FindingsReport } from '../src/findings/analysis-service.js';

/**
 * M2 DoD (plan §2, ADR-0028): a local-feed enrichment produces a Finding
 * citing the enrichment Evidence with zero egress; re-analysis over unchanged
 * enrichment is identical; staleness is surfaced; IP/domain egress lookups are
 * impossible without their explicit opt-in.
 */

const HASH = 'cd'.repeat(32);

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/projects', payload: { name: 'M2' } });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

/** Commit a device-state report so a Device with a hashed file exists. */
async function importHostWithFile(app: FastifyInstance, projectId: string): Promise<void> {
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
        administrators: [],
        sudoers: [],
        collection: { scope: ['interfaces', 'fileInventory'], errors: [] },
        fileInventory: [{ path: 'C:\\ProgramData\\svc\\updater.exe', sha256: HASH }],
      },
    ],
  };
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

async function putFeed(app: FastifyInstance, projectId: string, entries: unknown[]): Promise<void> {
  const res = await app.inject({
    method: 'PUT',
    url: `/projects/${projectId}/threat-intel/feed`,
    payload: { entries },
  });
  expect(res.statusCode).toBe(200);
}

async function fetchEnrichment(
  app: FastifyInstance,
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: `/projects/${projectId}/enrichments`,
    payload: body,
  });
}

describe('M2: local-feed enrichment is collection, not detection', () => {
  it('a local-feed enrichment produces a Finding citing the enrichment Evidence — with zero egress', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    await importHostWithFile(app, projectId);
    await putFeed(app, projectId, [
      {
        indicatorType: 'fileHash',
        indicator: HASH,
        verdict: 'malicious',
        score: 0.97,
        detail: 'test IoC set',
      },
    ]);

    // egress stays OFF: the local feed is the zero-egress mode
    const res = await fetchEnrichment(app, projectId, { indicatorType: 'fileHash', query: HASH });
    expect(res.statusCode).toBe(201);
    const view: EnrichmentView = res.json();
    expect(view.payload.response.verdict).toBe('malicious');
    expect(view.stale).toBe(false);

    // the enrichment landed as read-only Evidence with a stored blob
    const blob = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/evidence/${view.evidenceId}` })
      .then((r) => r.json());
    expect(JSON.parse(blob.content).kind).toBe('threatIntelEnrichment');

    // detection consumed the stored payload — no live call — and cites it
    const report: FindingsReport = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/findings` })
      .then((r) => r.json());
    const finding = report.findings.find((f) => f.detection?.ruleId === 'enrichment.fileHashMatch');
    expect(finding).toBeDefined();
    expect(finding?.detection?.evidenceRefs).toContain(view.evidenceId);
    expect(finding?.detection?.severity).toBe('critical');
    expect(finding?.detection?.explanation).toContain('Enriched by local-feed at');

    // zero egress: the outbound-call audit trail is empty
    const audit: EgressAuditRecord[] = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/egress/audit` })
      .then((r) => r.json());
    expect(audit).toEqual([]);
  });

  it('re-running analysis over unchanged enrichment Evidence yields identical findings (I2)', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    await importHostWithFile(app, projectId);
    await putFeed(app, projectId, [
      { indicatorType: 'fileHash', indicator: HASH, verdict: 'malicious' },
    ]);
    await fetchEnrichment(app, projectId, { indicatorType: 'fileHash', query: HASH });

    const first: FindingsReport = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/findings` })
      .then((r) => r.json());
    const second: FindingsReport = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/findings` })
      .then((r) => r.json());
    expect(second.findings).toEqual(first.findings);
    expect(second.configHash).toBe(first.configHash);
  });

  it('a feed update does not change findings until an explicit re-fetch stores new Evidence', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    await importHostWithFile(app, projectId);
    await putFeed(app, projectId, [
      { indicatorType: 'fileHash', indicator: HASH, verdict: 'benign' },
    ]);
    await fetchEnrichment(app, projectId, { indicatorType: 'fileHash', query: HASH });

    const before: FindingsReport = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/findings` })
      .then((r) => r.json());
    expect(
      before.findings.filter((f) => f.detection?.ruleId === 'enrichment.fileHashMatch'),
    ).toHaveLength(0);

    // the feed flips to malicious — stored Evidence is unchanged, findings too
    await putFeed(app, projectId, [
      { indicatorType: 'fileHash', indicator: HASH, verdict: 'malicious' },
    ]);
    const unchanged: FindingsReport = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/findings` })
      .then((r) => r.json());
    expect(
      unchanged.findings.filter((f) => f.detection?.ruleId === 'enrichment.fileHashMatch'),
    ).toHaveLength(0);

    // an explicit re-fetch is a NEW Evidence artifact; now the finding appears
    const refetch = await fetchEnrichment(app, projectId, {
      indicatorType: 'fileHash',
      query: HASH,
    });
    expect(refetch.statusCode).toBe(201);
    const after: FindingsReport = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/findings` })
      .then((r) => r.json());
    expect(
      after.findings.filter((f) => f.detection?.ruleId === 'enrichment.fileHashMatch'),
    ).toHaveLength(1);

    const enrichments: EnrichmentView[] = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/enrichments` })
      .then((r) => r.json());
    expect(enrichments).toHaveLength(2);
  });

  it('enrichment provenance flows into the redacted findings report, hash masked', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    await importHostWithFile(app, projectId);
    await putFeed(app, projectId, [
      { indicatorType: 'fileHash', indicator: HASH, verdict: 'malicious' },
    ]);
    await fetchEnrichment(app, projectId, { indicatorType: 'fileHash', query: HASH });

    const html = await app
      .inject({
        method: 'GET',
        url: `/projects/${projectId}/report/findings?redact=client-safe`,
      })
      .then((r) => r.body);
    expect(html).toContain('Enriched by local-feed at');
    expect(html).not.toContain(HASH);
  });

  it('a stale enrichment is surfaced as stale', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    await putFeed(app, projectId, [
      { indicatorType: 'fileHash', indicator: HASH, verdict: 'malicious' },
    ]);
    const res = await fetchEnrichment(app, projectId, {
      indicatorType: 'fileHash',
      query: HASH,
      ttlSeconds: 1,
    });
    expect(res.statusCode).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const enrichments: EnrichmentView[] = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/enrichments` })
      .then((r) => r.json());
    expect(enrichments).toHaveLength(1);
    expect(enrichments[0]?.stale).toBe(true);
  });
});

describe('M2: project deletion cleans the Phase-4 sidecars', () => {
  it('a project with egress settings, a feed, enrichments and audit rows deletes cleanly', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/egress/settings`,
      payload: { enabled: true, acknowledgeDisclosure: true },
    });
    await putFeed(app, projectId, [
      { indicatorType: 'fileHash', indicator: HASH, verdict: 'malicious' },
    ]);
    await fetchEnrichment(app, projectId, { indicatorType: 'fileHash', query: HASH });
    await fetchEnrichment(app, projectId, {
      providerId: 'stub',
      indicatorType: 'fileHash',
      query: HASH,
    });

    const del = await app.inject({ method: 'DELETE', url: `/projects/${projectId}` });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({ method: 'GET', url: `/projects/${projectId}` });
    expect(gone.statusCode).toBe(404);
  });
});

describe('M2: hash-first — IP/domain egress lookups are gated per type', () => {
  it('an ip lookup through an egress provider is impossible without the ip opt-in', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/egress/settings`,
      payload: { enabled: true, acknowledgeDisclosure: true },
    });

    // fileHash rides the base opt-in
    const hashRes = await fetchEnrichment(app, projectId, {
      providerId: 'stub',
      indicatorType: 'fileHash',
      query: HASH,
    });
    expect(hashRes.statusCode).toBe(201);

    // ip does not — blocked at the door, audited, nothing stored
    const ipRes = await fetchEnrichment(app, projectId, {
      providerId: 'stub',
      indicatorType: 'ip',
      query: '203.0.113.7',
    });
    expect(ipRes.statusCode).toBe(403);
    expect(ipRes.json().code).toBe('EGRESS_BLOCKED');

    const enrichments: EnrichmentView[] = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/enrichments` })
      .then((r) => r.json());
    expect(enrichments.filter((e) => e.payload.indicatorType === 'ip')).toHaveLength(0);

    const audit: EgressAuditRecord[] = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/egress/audit` })
      .then((r) => r.json());
    expect(audit.map((a) => a.outcome)).toEqual(['success', 'blocked']);

    // after the per-type opt-in, the same lookup goes through
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/egress/settings`,
      payload: {
        enabled: true,
        allowedIndicatorTypes: ['fileHash', 'ip'],
        acknowledgeDisclosure: true,
      },
    });
    const allowed = await fetchEnrichment(app, projectId, {
      providerId: 'stub',
      indicatorType: 'ip',
      query: '203.0.113.7',
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('ip/domain lookups against the local feed work with the door shut — zero-egress by design', async () => {
    // The per-type opt-in gates what LEAVES (Q10); a local lookup reveals
    // nothing to anyone, so the shut-door mode stays fully usable (ADR-0027).
    const app = await createApp();
    const projectId = await createProject(app);
    await putFeed(app, projectId, [
      { indicatorType: 'ip', indicator: '203.0.113.7', verdict: 'malicious' },
    ]);
    const res = await fetchEnrichment(app, projectId, {
      indicatorType: 'ip',
      query: '203.0.113.7',
    });
    expect(res.statusCode).toBe(201);
    const view: EnrichmentView = res.json();
    expect(view.payload.response.verdict).toBe('malicious');

    const audit: EgressAuditRecord[] = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/egress/audit` })
      .then((r) => r.json());
    expect(audit).toEqual([]);
  });

  it('with egress off, an egress-requiring provider fetch is blocked entirely', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const res = await fetchEnrichment(app, projectId, {
      providerId: 'stub',
      indicatorType: 'fileHash',
      query: HASH,
    });
    expect(res.statusCode).toBe(403);
  });
});
