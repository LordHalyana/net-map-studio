import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  changeSetIdSchema,
  deviceIdSchema,
  deviceSchema,
  flowIdSchema,
  flowSchema,
  newId,
  operationIdSchema,
  projectStateSchema,
  type Operation,
} from '@netplan/domain';
import { buildApp } from '../src/app.js';
import type { FindingsReport } from '../src/findings/analysis-service.js';

/**
 * Improvements M14 (#71): the ADR-0019 tier — ~500 devices / ~5k aggregated
 * flows must not ride on every response. Flows paginate, mutations can go
 * slim, findings analysis caches on the watermark, and the bundle streams.
 */

const DEVICE_COUNT = 500;
const FLOW_COUNT = 5000;

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function seed(app: FastifyInstance): Promise<{ id: string; deviceIds: string[] }> {
  const { id } = await app
    .inject({ method: 'POST', url: '/projects', payload: { name: 'scale' } })
    .then((r) => r.json());
  const ops: Operation[] = [];
  const deviceIds: string[] = [];
  for (let i = 0; i < DEVICE_COUNT; i++) {
    const device = deviceSchema.parse({
      id: newId(deviceIdSchema),
      projectId: id,
      name: `host-${i}`,
      deviceType: 'workstation',
      lifecycleState: 'observed',
      position: { x: (i % 25) * 200, y: Math.floor(i / 25) * 130 },
    });
    deviceIds.push(device.id);
    ops.push({
      id: newId(operationIdSchema),
      projectId: id,
      kind: 'CreateEntity',
      payload: { entityType: 'device', entity: device },
    });
  }
  for (let i = 0; i < FLOW_COUNT; i++) {
    const src = deviceIds[i % DEVICE_COUNT]!;
    const dst = deviceIds[(i * 7 + 1) % DEVICE_COUNT]!;
    const flow = flowSchema.parse({
      id: newId(flowIdSchema),
      projectId: id,
      source: { kind: 'device', id: src },
      destination: { kind: 'device', id: dst },
      protocol: 'tcp',
      port: 400 + (i % 20),
      firstSeen: '2026-07-01T00:00:00.000Z',
      lastSeen: '2026-07-15T00:00:00.000Z',
      observationCount: 1 + (i % 9),
      confidence: 0.4,
      lifecycleState: 'observed',
    });
    ops.push({
      id: newId(operationIdSchema),
      projectId: id,
      kind: 'CreateEntity',
      payload: { entityType: 'flow', entity: flow },
    });
  }
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${id}/operations`,
    payload: { id: newId(changeSetIdSchema), projectId: id, label: 'seed scale', operations: ops },
  });
  expect(res.statusCode).toBe(200);
  return { id, deviceIds };
}

describe('M14 API scale (#71)', () => {
  it('graph load stays under threshold and can omit or cap flows', async () => {
    const app = await createApp();
    const { id } = await seed(app);

    const started = Date.now();
    const full = projectStateSchema.parse(
      (await app.inject({ method: 'GET', url: `/projects/${id}/graph` })).json(),
    );
    const loadMs = Date.now() - started;
    expect(full.devices).toHaveLength(DEVICE_COUNT);
    expect(full.flows).toHaveLength(FLOW_COUNT);
    expect(loadMs).toBeLessThan(3000);

    const omitted = projectStateSchema.parse(
      (await app.inject({ method: 'GET', url: `/projects/${id}/graph?flows=omit` })).json(),
    );
    expect(omitted.flows).toHaveLength(0);
    expect(omitted.devices).toHaveLength(DEVICE_COUNT);

    const capped = projectStateSchema.parse(
      (await app.inject({ method: 'GET', url: `/projects/${id}/graph?flows=100` })).json(),
    );
    expect(capped.flows).toHaveLength(100);
  });

  it('the flows endpoint paginates and filters', async () => {
    const app = await createApp();
    const { id, deviceIds } = await seed(app);

    const page = await app
      .inject({ method: 'GET', url: `/projects/${id}/flows?limit=250&offset=0` })
      .then((r) => r.json());
    expect(page.total).toBe(FLOW_COUNT);
    expect(page.flows).toHaveLength(250);

    const second = await app
      .inject({ method: 'GET', url: `/projects/${id}/flows?limit=250&offset=250` })
      .then((r) => r.json());
    expect(second.flows[0].id).not.toBe(page.flows[0].id);

    // endpoint filter
    const byDevice = await app
      .inject({ method: 'GET', url: `/projects/${id}/flows?endpoint=${deviceIds[0]}&limit=5000` })
      .then((r) => r.json());
    expect(byDevice.flows.length).toBeGreaterThan(0);
    for (const flow of byDevice.flows) {
      expect([flow.source.id, flow.destination.id]).toContain(deviceIds[0]);
    }

    // service (port) filter
    const byPort = await app
      .inject({ method: 'GET', url: `/projects/${id}/flows?service=405&limit=5000` })
      .then((r) => r.json());
    expect(byPort.flows.length).toBeGreaterThan(0);
    for (const flow of byPort.flows) expect(flow.port).toBe(405);
  });

  it('findings analysis is cached between edits and recomputes after a mutation', async () => {
    const app = await createApp();
    const { id, deviceIds } = await seed(app);

    const first: FindingsReport = await app
      .inject({ method: 'GET', url: `/projects/${id}/findings` })
      .then((r) => r.json());
    const startCached = Date.now();
    const second: FindingsReport = await app
      .inject({ method: 'GET', url: `/projects/${id}/findings` })
      .then((r) => r.json());
    const cachedMs = Date.now() - startCached;
    // same watermark → identical report, served fast from cache
    expect(second.opSeq).toBe(first.opSeq);
    expect(second).toEqual(first);
    expect(cachedMs).toBeLessThan(50);

    // a mutation moves the watermark → the cache invalidates
    await app.inject({
      method: 'POST',
      url: `/projects/${id}/operations`,
      payload: {
        id: newId(operationIdSchema),
        projectId: id,
        kind: 'SetField',
        entityType: 'device',
        entityId: deviceIds[0],
        field: 'name',
        value: 'host-0-renamed',
        previousValue: 'host-0',
      },
    });
    const third: FindingsReport = await app
      .inject({ method: 'GET', url: `/projects/${id}/findings` })
      .then((r) => r.json());
    expect(third.opSeq).toBeGreaterThan(first.opSeq);
  });

  it('a slim mutation returns the watermark without the full state', async () => {
    const app = await createApp();
    const { id, deviceIds } = await seed(app);

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${id}/operations?slim=1`,
      payload: {
        id: newId(operationIdSchema),
        projectId: id,
        kind: 'SetField',
        entityType: 'device',
        entityId: deviceIds[1],
        field: 'vendor',
        value: 'Acme',
        previousValue: '',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBeUndefined();
    expect(typeof body.watermark).toBe('number');
    expect(body.appliedOperations).toHaveLength(1);

    // the non-slim path still carries the full state for the client's reconcile
    const full = await app
      .inject({
        method: 'POST',
        url: `/projects/${id}/operations`,
        payload: {
          id: newId(operationIdSchema),
          projectId: id,
          kind: 'SetField',
          entityType: 'device',
          entityId: deviceIds[1],
          field: 'model',
          value: 'X',
          previousValue: '',
        },
      })
      .then((r) => r.json());
    expect(full.state.devices).toHaveLength(DEVICE_COUNT);
  });

  it('the bundle streams at the scale tier', async () => {
    const app = await createApp();
    const { id } = await seed(app);
    const res = await app.inject({ method: 'GET', url: `/projects/${id}/export` });
    expect(res.statusCode).toBe(200);
    const bundle = JSON.parse(res.body);
    expect(bundle.format).toBe('netplan');
    expect(bundle.project.devices).toHaveLength(DEVICE_COUNT);
    expect(bundle.project.flows).toHaveLength(FLOW_COUNT);
  });
});
