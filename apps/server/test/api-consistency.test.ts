import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mutationResponseSchema, newId, projectIdSchema } from '@netplan/domain';
import { makeDevice } from '@netplan/domain/fixtures';
import { buildApp } from '../src/app.js';
import { createDeviceOp } from './helpers.js';

/**
 * #110 C4: API-consistency trio — enrichments 404 on unknown projects like
 * every sibling route, and undo/redo responses carry the same watermark and
 * slim contract as /operations.
 */

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance) {
  return (await app.inject({ method: 'POST', url: '/projects', payload: { name: 'C4' } })).json();
}

describe('enrichments routes 404 on unknown projects (#110 C4)', () => {
  it('GET returns 404, not an empty list', async () => {
    const app = await createApp();
    const missing = newId(projectIdSchema);
    const res = await app.inject({ method: 'GET', url: `/projects/${missing}/enrichments` });
    expect(res.statusCode).toBe(404);
  });

  it('POST returns 404 instead of writing orphan evidence', async () => {
    const app = await createApp();
    const missing = newId(projectIdSchema);
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${missing}/enrichments`,
      payload: { indicatorType: 'ip', query: '203.0.113.7' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET still returns a (possibly empty) list for a real project', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const res = await app.inject({ method: 'GET', url: `/projects/${project.id}/enrichments` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('undo/redo response parity with /operations (#110 C4)', () => {
  it('returns the operations response shape, watermark included', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const device = makeDevice(project.id);
    await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/operations`,
      payload: createDeviceOp(project, device),
    });

    const undo = await app.inject({ method: 'POST', url: `/projects/${project.id}/undo` });
    expect(undo.statusCode).toBe(200);
    const undone = mutationResponseSchema.parse(undo.json());
    expect(undone.watermark).toBeGreaterThan(0);
    expect(undone.state.devices).toHaveLength(0);

    const redo = await app.inject({ method: 'POST', url: `/projects/${project.id}/redo` });
    const redone = mutationResponseSchema.parse(redo.json());
    // every log append moves the watermark — redo lands after undo
    expect(redone.watermark).toBeGreaterThan(undone.watermark);
    expect(redone.state.devices).toHaveLength(1);
  });

  it('honors ?slim=1 exactly like /operations: watermark, no state', async () => {
    const app = await createApp();
    const project = await createProject(app);
    await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/operations`,
      payload: createDeviceOp(project, makeDevice(project.id)),
    });

    const undo = await app.inject({ method: 'POST', url: `/projects/${project.id}/undo?slim=1` });
    expect(undo.statusCode).toBe(200);
    const body = undo.json();
    expect(body.watermark).toBeGreaterThan(0);
    expect(body.state).toBeUndefined();
    expect(body.availability).toBeDefined();

    const redo = await app.inject({ method: 'POST', url: `/projects/${project.id}/redo?slim=1` });
    expect(redo.json().state).toBeUndefined();
    expect(redo.json().watermark).toBeGreaterThan(body.watermark);
  });
});
