import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Flow, Observation } from '@netplan/domain';
import { buildApp } from '../src/app.js';
import { startBudget, DEFAULT_PARSE_LIMITS } from '../src/imports/guards.js';
import { zeekConnAdapter } from '../src/imports/adapters/zeek-conn.js';
import type { ImportJobDetail } from '../src/imports/store.js';

/**
 * P4-M4 DoD: importing a fixture Zeek conn.log produces aggregated Flow
 * Observations that reconcile into Flows, each traceable to the Evidence,
 * respecting the SMB-tier aggregation ceiling (ADR-0019). Hermetic.
 */

const TSV_HEADER = [
  '#separator \\x09',
  '#set_separator\t,',
  '#empty_field\t(empty)',
  '#unset_field\t-',
  '#path\tconn',
  '#fields\tts\tuid\tid.orig_h\tid.orig_p\tid.resp_h\tid.resp_p\tproto\tservice\tduration',
  '#types\ttime\tstring\taddr\tport\taddr\tport\tenum\tstring\tinterval',
].join('\n');

function tsvRow(
  ts: number,
  origH: string,
  respH: string,
  respP: number | '-',
  proto = 'tcp',
  duration: number | '-' = 1.5,
): string {
  return [ts, 'C1234', origH, 51515, respH, respP, proto, '-', duration].join('\t');
}

const TSV_FIXTURE = [
  TSV_HEADER,
  tsvRow(1752537600, '10.0.0.5', '10.0.0.9', 443),
  tsvRow(1752537660, '10.0.0.5', '10.0.0.9', 443), // same conversation — must aggregate
  tsvRow(1752537700, '10.0.0.5', '93.184.216.34', 80),
  tsvRow(1752537710, '10.0.0.6', '10.0.0.9', 53, 'udp', '-'),
].join('\n');

function budgetCtx() {
  return { budget: startBudget(DEFAULT_PARSE_LIMITS), limits: DEFAULT_PARSE_LIMITS };
}

describe('P4-M4: zeek-conn parse function (pure, fixture-driven)', () => {
  it('parses TSV conn.log and aggregates per (source, destination, service)', async () => {
    const drafts = await zeekConnAdapter.parse(TSV_FIXTURE, budgetCtx());
    expect(drafts).toHaveLength(3);

    const aggregated = drafts.find(
      (d) =>
        d.claim.targetKind === 'flow' &&
        d.claim.destination.ip === '10.0.0.9' &&
        d.claim.port === 443,
    );
    expect(aggregated?.claim.targetKind).toBe('flow');
    if (aggregated?.claim.targetKind === 'flow') {
      expect(aggregated.claim.count).toBe(2);
      expect(aggregated.claim.protocol).toBe('tcp');
      // firstSeen from the first row, lastSeen = later ts + duration
      expect(aggregated.claim.firstSeen).toBe('2025-07-15T00:00:00.000Z');
      expect(aggregated.claim.lastSeen).toBe('2025-07-15T00:01:01.500Z');
    }
    expect(drafts.every((d) => d.contributor === 'trafficObservation')).toBe(true);
  });

  it('parses JSON-lines conn.log to the same aggregates', async () => {
    const jsonLines = [
      JSON.stringify({
        ts: 1752537600.0,
        'id.orig_h': '10.0.0.5',
        'id.orig_p': 51515,
        'id.resp_h': '10.0.0.9',
        'id.resp_p': 443,
        proto: 'tcp',
        duration: 1.5,
      }),
      JSON.stringify({
        ts: 1752537660.0,
        'id.orig_h': '10.0.0.5',
        'id.orig_p': 51516,
        'id.resp_h': '10.0.0.9',
        'id.resp_p': 443,
        proto: 'tcp',
      }),
    ].join('\n');
    const drafts = await zeekConnAdapter.parse(jsonLines, budgetCtx());
    expect(drafts).toHaveLength(1);
    if (drafts[0]?.claim.targetKind === 'flow') {
      expect(drafts[0].claim.count).toBe(2);
    }
  });

  it('a large log respects the aggregation ceiling: many rows, few claims (ADR-0019)', async () => {
    // 20k connections across 50 distinct conversations
    const rows: string[] = [TSV_HEADER];
    for (let i = 0; i < 20_000; i++) {
      rows.push(tsvRow(1752537600 + i, `10.0.1.${i % 50}`, '10.0.0.9', 443));
    }
    const drafts = await zeekConnAdapter.parse(rows.join('\n'), budgetCtx());
    expect(drafts).toHaveLength(50);
    const total = drafts.reduce(
      (sum, d) => sum + (d.claim.targetKind === 'flow' ? d.claim.count : 0),
      0,
    );
    expect(total).toBe(20_000);
  });

  it('rejects content with no #fields header', async () => {
    await expect(
      Promise.resolve(zeekConnAdapter.parse('10.0.0.5\t10.0.0.9\n', budgetCtx())),
    ).rejects.toThrow(/#fields/);
  });
});

describe('P4-M4: zeek-conn through the import pipeline (end-to-end)', () => {
  async function createApp(): Promise<FastifyInstance> {
    return buildApp({ dbFile: ':memory:', logger: false });
  }

  it('imports a fixture conn.log into committed Flows traceable to the Evidence', async () => {
    const app = await createApp();
    const { id: projectId } = await app
      .inject({ method: 'POST', url: '/projects', payload: { name: 'M4' } })
      .then((r) => r.json());

    const upload = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports`,
      payload: { filename: 'conn.log', adapter: 'zeek-conn', content: TSV_FIXTURE },
    });
    expect(upload.statusCode).toBe(202);
    const job = upload.json();
    await app.importStore.whenIdle();

    const detail: ImportJobDetail = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/imports/${job.id}` })
      .then((r) => r.json());
    expect(detail.job.status).toBe('review');
    expect(detail.observations).toHaveLength(3);
    const evidenceId = detail.evidence[0]?.id;
    expect(detail.observations.every((o: Observation) => o.evidenceId === evidenceId)).toBe(true);

    const commit = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports/${job.id}/commit`,
    });
    expect(commit.statusCode).toBe(200);
    const flows: Flow[] = commit.json().state.flows;
    expect(flows).toHaveLength(3);

    const aggregated = flows.find((f) => f.port === 443 && f.destination.kind === 'external');
    expect(aggregated?.observationCount).toBe(2);
    // flow endpoints never fabricate Devices (ADR-0020)
    expect(commit.json().state.devices).toHaveLength(0);
  });
});
