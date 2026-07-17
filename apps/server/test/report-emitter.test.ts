import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance, type RouteHandlerMethod } from 'fastify';
import { describe, expect, it } from 'vitest';
import { maskSecrets } from '@netplan/domain';
import { createReportEmitter } from '../src/export/report-emitter.js';
import { createTestEngine } from './helpers.js';

/**
 * Report emission module (#81): every deliverable is secrets-masked, SHA-256
 * hashed and audited as a §3.4 Report record through the Operation log — one
 * interface, so the M13 guarantees hold by construction, not by discipline.
 */

const SECRET = 'password=Hunter2Hunter2';

function setup() {
  const { engine, project } = createTestEngine();
  const emitter = createReportEmitter(engine);
  const app = Fastify({ logger: false });
  return { engine, project, emitter, app };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function injectRoute(
  app: FastifyInstance,
  handler: RouteHandlerMethod,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  app.get('/deliverable', handler);
  return app.inject({ method: 'GET', url: '/deliverable' });
}

describe('report emitter (#81)', () => {
  it('masks secrets in the emitted body — the builder never has to', async () => {
    const { engine, project, emitter, app } = setup();
    const res = await injectRoute(app, async (_req, reply) =>
      emitter.emit(reply, project.id, {
        type: 'designReport',
        redactionProfile: '',
        contentType: 'text/html; charset=utf-8',
        build: () => `<html>${SECRET}</html>`,
      }),
    );
    expect(res.body).not.toContain('Hunter2Hunter2');
    expect(res.body).toContain('[redacted]');
    expect(engine.getState(project.id).reports).toHaveLength(1);
  });

  it('hashes the masked bytes — mask happens before hash', async () => {
    const { engine, project, emitter, app } = setup();
    const raw = `report body ${SECRET}`;
    await injectRoute(app, async (_req, reply) =>
      emitter.emit(reply, project.id, {
        type: 'findingsReport',
        redactionProfile: 'client-safe',
        contentType: 'text/html; charset=utf-8',
        build: () => raw,
      }),
    );
    const [record] = engine.getState(project.id).reports;
    expect(record?.outputSha256).toBe(sha256(maskSecrets(raw)));
    expect(record?.outputSha256).not.toBe(sha256(raw));
  });

  it('records type, redaction profile and parameters on the Report record', async () => {
    const { engine, project, emitter, app } = setup();
    await injectRoute(app, async (_req, reply) =>
      emitter.emit(reply, project.id, {
        type: 'csv',
        redactionProfile: 'client-safe',
        parameters: { entityType: 'devices' },
        contentType: 'text/csv; charset=utf-8',
        filename: 'devices.csv',
        build: () => 'id,name\n',
      }),
    );
    const [record] = engine.getState(project.id).reports;
    expect(record?.type).toBe('csv');
    expect(record?.redactionProfile).toBe('client-safe');
    expect(record?.parameters).toEqual({ entityType: 'devices' });
  });

  it('owns the response headers, including the download filename', async () => {
    const { project, emitter, app } = setup();
    const res = await injectRoute(app, async (_req, reply) =>
      emitter.emit(reply, project.id, {
        type: 'csv',
        redactionProfile: '',
        parameters: { entityType: 'devices' },
        contentType: 'text/csv; charset=utf-8',
        filename: 'devices.csv',
        build: () => 'id,name\n',
      }),
    );
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="devices.csv"');
  });

  it('emitStream passes chunks through verbatim and records the streamed hash', async () => {
    const { engine, project, emitter, app } = setup();
    // The secret must SURVIVE: the bundle is the full-fidelity project file
    // (ADR-0016) — masking would corrupt evidence verified by hash on re-import.
    const chunks = ['{"evidence":', `"${SECRET}"}`];
    const res = await injectRoute(app, async (_req, reply) =>
      emitter.emitStream(reply, project.id, {
        type: 'bundle',
        redactionProfile: 'name',
        contentType: 'application/json; charset=utf-8',
        chunks: (function* () {
          yield* chunks;
        })(),
      }),
    );
    expect(res.body).toBe(chunks.join(''));
    expect(res.body).toContain('Hunter2Hunter2'); // unmasked, by design
    const [record] = engine.getState(project.id).reports;
    expect(record?.type).toBe('bundle');
    expect(record?.redactionProfile).toBe('name');
    expect(record?.outputSha256).toBe(sha256(chunks.join('')));
  });
});
