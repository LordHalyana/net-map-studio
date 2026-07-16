import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  deviceIdSchema,
  deviceSchema,
  newId,
  operationIdSchema,
  projectStateSchema,
} from '@netplan/domain';
import { buildApp } from '../src/app.js';

/**
 * Improvements M11 (#68): every generated deliverable writes a §3.4 Report
 * record through the Operation log; the change report renders AS-IS→TO-BE;
 * the CSV surface covers identities and flows.
 */

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance): Promise<string> {
  const { id } = await app
    .inject({ method: 'POST', url: '/projects', payload: { name: 'Reports' } })
    .then((r) => r.json());
  return id;
}

async function getReports(app: FastifyInstance, id: string) {
  const res = await app.inject({ method: 'GET', url: `/projects/${id}/graph` });
  return projectStateSchema.parse(res.json()).reports;
}

describe('M11 report records & export gaps (#68)', () => {
  it('design/findings/change reports and CSVs each write a Report record with the output hash', async () => {
    const app = await createApp();
    const id = await createProject(app);

    const design = await app.inject({ method: 'GET', url: `/projects/${id}/report` });
    expect(design.statusCode).toBe(200);
    const findings = await app.inject({
      method: 'GET',
      url: `/projects/${id}/report/findings?redact=client-safe`,
    });
    expect(findings.statusCode).toBe(200);
    const change = await app.inject({ method: 'GET', url: `/projects/${id}/report/change` });
    expect(change.statusCode).toBe(200);
    const csv = await app.inject({ method: 'GET', url: `/projects/${id}/export/csv/devices` });
    expect(csv.statusCode).toBe(200);

    const reports = await getReports(app, id);
    const types = reports.map((r) => r.type).sort();
    expect(types).toEqual(['changeReport', 'csv', 'designReport', 'findingsReport']);
    for (const report of reports) {
      expect(report.outputSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(reports.find((r) => r.type === 'findingsReport')?.redactionProfile).toBe('client-safe');
    expect(reports.find((r) => r.type === 'csv')?.parameters['entityType']).toBe('devices');
  });

  it('report records survive an export/import round trip', async () => {
    const app = await createApp();
    const id = await createProject(app);
    await app.inject({ method: 'GET', url: `/projects/${id}/report` });

    const bundleRes = await app.inject({ method: 'GET', url: `/projects/${id}/export` });
    expect(bundleRes.statusCode).toBe(200);
    const bundle = bundleRes.json();
    // the bundle itself is recorded too — but as of serialization time it
    // carries the earlier designReport record
    const carried = bundle.project.reports;
    expect(carried.some((r: { type: string }) => r.type === 'designReport')).toBe(true);

    // same-id imports are refused while the project exists — delete first
    await app.inject({ method: 'DELETE', url: `/projects/${id}` });
    const imported = await app.inject({
      method: 'POST',
      url: '/projects/import',
      payload: bundle,
    });
    expect(imported.statusCode).toBe(201);
    const newId = imported.json().id;
    const restored = await getReports(app, newId);
    expect(restored.some((r) => r.type === 'designReport')).toBe(true);
  });

  it('identities and flows are exportable as CSV', async () => {
    const app = await createApp();
    const id = await createProject(app);
    for (const entity of ['identities', 'flows']) {
      const res = await app.inject({ method: 'GET', url: `/projects/${id}/export/csv/${entity}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    }
  });

  it('the change report renders planned additions and proposal removals', async () => {
    const app = await createApp();
    const id = await createProject(app);

    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/projects/${id}/operations`, payload });

    const planned = deviceSchema.parse({
      id: newId(deviceIdSchema),
      projectId: id,
      name: 'future-fw',
      deviceType: 'firewall',
      lifecycleState: 'planned',
    });
    const doomed = deviceSchema.parse({
      id: newId(deviceIdSchema),
      projectId: id,
      name: 'legacy-hub',
      deviceType: 'switch',
      lifecycleState: 'observed',
    });
    await post({
      id: newId(operationIdSchema),
      projectId: id,
      kind: 'CreateEntity',
      payload: { entityType: 'device', entity: planned },
    });
    await post({
      id: newId(operationIdSchema),
      projectId: id,
      kind: 'CreateEntity',
      payload: { entityType: 'device', entity: doomed },
    });
    await post({
      id: newId(operationIdSchema),
      projectId: id,
      kind: 'SetField',
      entityType: 'device',
      entityId: doomed.id,
      field: 'lifecycleState',
      value: 'removedInProposal',
      previousValue: 'observed',
    });

    const res = await app.inject({ method: 'GET', url: `/projects/${id}/report/change` });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(html).toContain('future-fw');
    expect(html).toContain('legacy-hub');
    expect(html).toContain('AS-IS → TO-BE');
  });
});
