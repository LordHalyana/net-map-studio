import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ImportJob, ImportProposal, Observation, ProjectState } from '@netplan/domain';
import { buildApp } from '../src/app.js';

/** M6 DoD: ~100k conversations aggregate to ≤~5k Flows in the worker without
 * blocking the API; unknown endpoints stay external, no invented Devices. */

async function newProject(app: FastifyInstance): Promise<string> {
  const project = await app
    .inject({ method: 'POST', url: '/projects', payload: { name: 'P' } })
    .then((r) => r.json());
  return project.id;
}

interface Detail {
  job: ImportJob;
  observations: Observation[];
  proposal: ImportProposal | null;
}

describe('M6: tshark flow-summary adapter at SMB scale', () => {
  it('aggregates 100k conversations to ≤5k flows with correct counts, off the request path', async () => {
    const app = await buildApp({ dbFile: ':memory:', logger: false });
    const projectId = await newProject(app);

    // 100_000 conversations over 4_000 distinct (source, destination, port) tuples
    const TUPLES = 4000;
    const CONVERSATIONS = 100_000;
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < CONVERSATIONS; i++) {
      const tuple = i % TUPLES;
      const src = `10.1.${Math.floor(tuple / 250) % 250}.${tuple % 250}`;
      rows.push({
        source: src,
        destination: '10.0.0.10',
        protocol: 'tcp',
        port: 443,
        frames: 2,
        firstSeen: 1783500000 + i,
        lastSeen: 1783500001 + i,
      });
    }

    const started = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports`,
      payload: {
        filename: 'conversations.json',
        adapter: 'tshark-flows',
        content: JSON.stringify(rows),
      },
    });
    expect(res.statusCode).toBe(202);
    const accepted = Date.now() - started;

    // the API answered immediately and stays responsive while the worker chews
    const healthStarted = Date.now();
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(Date.now() - healthStarted).toBeLessThan(1000);
    expect(accepted).toBeLessThan(5000);

    const job: ImportJob = res.json();
    await app.importStore.whenIdle();
    const detail: Detail = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/imports/${job.id}` })
      .then((r) => r.json());
    expect(detail.job.status).toBe('review');

    // pre-aggregated in the adapter: observations ≈ tuples, not conversations
    expect(detail.observations.length).toBe(TUPLES);
    expect(detail.observations.length).toBeLessThanOrEqual(5000);

    const commit = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports/${detail.job.id}/commit`,
    });
    const state: ProjectState = commit.json().state;
    expect(state.flows).toHaveLength(TUPLES);
    // counts folded: 100k conversations / 4k tuples * 2 frames each
    const perFlow = (CONVERSATIONS / TUPLES) * 2;
    expect(state.flows[0]!.observationCount).toBe(perFlow);
    // seen-window folded to min/max of the tuple's conversations
    const flow0 = state.flows.find(
      (f) => f.source.kind === 'external' && f.source.value === '10.1.0.0',
    )!;
    expect(flow0.firstSeen).toBe(new Date(1783500000 * 1000).toISOString());
    // no Devices were invented for unknown endpoints
    expect(state.devices).toHaveLength(0);
    expect(state.flows.every((f) => f.confidence <= 0.5)).toBe(true);
  }, 60_000);

  it('parses CSV summaries and keeps known endpoints attached to committed devices', async () => {
    const app = await buildApp({ dbFile: ':memory:', logger: false });
    const projectId = await newProject(app);

    // commit one known device at 10.0.0.10 first
    const fixture = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports`,
      payload: {
        filename: 'fixture.json',
        adapter: 'fixture',
        content: JSON.stringify({
          fixture: true,
          devices: [{ name: 'web01', mac: 'aa:bb:cc:00:00:01', ip: '10.0.0.10' }],
        }),
      },
    });
    await app.importStore.whenIdle();
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports/${fixture.json().id}/commit`,
    });

    const csv = [
      'source,destination,protocol,port,frames,firstSeen,lastSeen',
      '203.0.113.9,10.0.0.10,tcp,443,10,2026-07-14T10:00:00Z,2026-07-14T11:00:00Z',
      '203.0.113.9,10.0.0.10,tcp,443,5,2026-07-14T09:00:00Z,2026-07-14T09:30:00Z',
      '10.0.0.10,198.51.100.7,udp,53,3,2026-07-14T10:05:00Z,2026-07-14T10:06:00Z',
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports`,
      payload: { filename: 'conv.csv', adapter: 'tshark-flows', content: csv },
    });
    const job: ImportJob = res.json();
    await app.importStore.whenIdle();
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports/${job.id}/commit`,
    });

    const state: ProjectState = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/graph` })
      .then((r) => r.json());
    expect(state.flows).toHaveLength(2);
    const inbound = state.flows.find((f) => f.port === 443)!;
    expect(inbound.observationCount).toBe(15);
    expect(inbound.firstSeen).toBe('2026-07-14T09:00:00.000Z');
    expect(inbound.lastSeen).toBe('2026-07-14T11:00:00.000Z');
    // the known endpoint resolved to the committed device; the unknown stayed external
    const web01 = state.devices.find((d) => d.name === 'web01')!;
    expect(inbound.destination).toEqual({ kind: 'device', id: web01.id });
    expect(inbound.source).toEqual({ kind: 'external', value: '203.0.113.9' });
    // still exactly one device — nothing invented
    expect(state.devices).toHaveLength(1);
  });
});
