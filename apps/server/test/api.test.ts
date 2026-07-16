import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { changeSetIdSchema, newId, projectIdSchema, type Project } from '@netplan/domain';
import { makeAddress, makeDevice, makeInterface, makeProject } from '@netplan/domain/fixtures';
import { buildApp } from '../src/app.js';
import { createDeviceOp, createInterfaceOp, opId } from './helpers.js';

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProjectViaApi(app: FastifyInstance): Promise<Project> {
  const res = await app.inject({
    method: 'POST',
    url: '/projects',
    payload: { name: 'API Test Project' },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('Project CRUD', () => {
  it('creates, lists, gets and deletes a project', async () => {
    const app = await createApp();
    const project = await createProjectViaApi(app);
    expect(project.name).toBe('API Test Project');
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await app.inject({ method: 'GET', url: '/projects' });
    expect(list.json()).toHaveLength(1);

    const got = await app.inject({ method: 'GET', url: `/projects/${project.id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().id).toBe(project.id);

    const del = await app.inject({ method: 'DELETE', url: `/projects/${project.id}` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/projects' })).json()).toHaveLength(0);
  });

  it('404s on a missing project', async () => {
    const app = await createApp();
    const ghost = newId(projectIdSchema);
    const res = await app.inject({ method: 'GET', url: `/projects/${ghost}` });
    expect(res.statusCode).toBe(404);
  });
});

describe('single mutation surface: POST /projects/:id/operations', () => {
  it('applies an Operation, returns state and undo availability, and persists', async () => {
    const app = await createApp();
    const project = await createProjectViaApi(app);
    const device = makeDevice(project.id);

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/operations`,
      payload: createDeviceOp(project, device),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.availability).toEqual({ canUndo: true, canRedo: false });
    expect(body.state.devices).toEqual([JSON.parse(JSON.stringify(device))]);

    const graph = await app.inject({ method: 'GET', url: `/projects/${project.id}/graph` });
    expect(graph.json().devices).toHaveLength(1);
  });

  it('applies a ChangeSet as one request', async () => {
    const app = await createApp();
    const project = await createProjectViaApi(app);
    const device = makeDevice(project.id);
    const iface = makeInterface(device);

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/operations`,
      payload: {
        id: newId(changeSetIdSchema),
        projectId: project.id,
        label: 'Add device with interface',
        operations: [createDeviceOp(project, device), createInterfaceOp(project, iface)],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().state.interfaces).toHaveLength(1);
  });

  it('rejects an invalid Operation with 400 before touching the DB', async () => {
    const app = await createApp();
    const project = await createProjectViaApi(app);

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/operations`,
      payload: { kind: 'CreateEntity', nonsense: true },
    });

    expect(res.statusCode).toBe(400);
    const log = await app.inject({ method: 'GET', url: `/projects/${project.id}/log` });
    expect(log.json()).toHaveLength(0);
  });

  it('404s when applying to an unknown project', async () => {
    const app = await createApp();
    const ghostProject = makeProject();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${ghostProject.id}/operations`,
      payload: createDeviceOp(ghostProject, makeDevice(ghostProject.id)),
    });
    expect(res.statusCode).toBe(404);
  });

  it('undo and redo endpoints drive the engine', async () => {
    const app = await createApp();
    const project = await createProjectViaApi(app);
    await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/operations`,
      payload: createDeviceOp(project, makeDevice(project.id)),
    });

    const undo = await app.inject({ method: 'POST', url: `/projects/${project.id}/undo` });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().state.devices).toHaveLength(0);

    const redo = await app.inject({ method: 'POST', url: `/projects/${project.id}/redo` });
    expect(redo.statusCode).toBe(200);
    expect(redo.json().state.devices).toHaveLength(1);

    const emptyRedo = await app.inject({ method: 'POST', url: `/projects/${project.id}/redo` });
    expect(emptyRedo.statusCode).toBe(409);
  });
});

describe('reads', () => {
  it('fetches one object with its relationships', async () => {
    const app = await createApp();
    const project = await createProjectViaApi(app);
    const device = makeDevice(project.id);
    const iface = makeInterface(device);
    const address = makeAddress(iface);
    for (const op of [
      createDeviceOp(project, device),
      createInterfaceOp(project, iface),
      {
        id: opId(),
        projectId: project.id,
        kind: 'CreateEntity',
        payload: { entityType: 'address', entity: address },
      },
    ]) {
      await app.inject({
        method: 'POST',
        url: `/projects/${project.id}/operations`,
        payload: op,
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/entities/device/${device.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entity.id).toBe(device.id);
    expect(body.relationships.interfaces).toHaveLength(1);
    expect(body.relationships.interfaces[0].addresses[0].value).toBe(address.value);
  });

  it('global search finds devices, addresses and networks', async () => {
    const app = await createApp();
    const project = await createProjectViaApi(app);
    const device = makeDevice(project.id, { name: 'edge-firewall-01', deviceType: 'firewall' });
    const iface = makeInterface(device);
    const address = makeAddress(iface, { value: '192.168.50.1' });
    for (const payload of [
      createDeviceOp(project, device),
      createInterfaceOp(project, iface),
      {
        id: opId(),
        projectId: project.id,
        kind: 'CreateEntity',
        payload: { entityType: 'address', entity: address },
      },
    ]) {
      await app.inject({ method: 'POST', url: `/projects/${project.id}/operations`, payload });
    }

    const byName = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/search?q=edge-firewall`,
    });
    expect(byName.json().some((r: { entityType: string }) => r.entityType === 'device')).toBe(true);

    const byIp = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/search?q=192.168.50`,
    });
    expect(byIp.json().some((r: { entityType: string }) => r.entityType === 'address')).toBe(true);
  });
});

describe('no write route bypasses the operation engine (M3 DoD)', () => {
  it('every mutating route is in the sanctioned allowlist', async () => {
    const app = await createApp();
    await app.ready();

    const sanctioned = new Set([
      'POST /projects', // project CRUD (workspace bootstrap, ADR-0010 scope)
      'DELETE /projects/:id', // project CRUD
      'POST /projects/import', // bundle restore (workspace bootstrap, ADR-0016)
      'POST /projects/:id/operations', // the single mutation surface
      'POST /projects/:id/undo', // engine-mediated
      'POST /projects/:id/redo', // engine-mediated
      // Evidence ingest (ADR-0019): writes the import spine only (jobs,
      // evidence, observations). Entity tables are untouched until the
      // reconciled ChangeSet commits through /operations-equivalent engine
      // paths (ADR-0021).
      'POST /projects/:id/imports',
      // Reconciliation (ADR-0021): resolve rewrites the pending (unapplied)
      // ChangeSet; commit/rollback apply it through engine.applyChangeSetWith
      // — the same apply core as /operations, logged identically.
      'POST /projects/:id/imports/:jobId/resolve',
      'POST /projects/:id/imports/:jobId/commit',
      'POST /projects/:id/imports/:jobId/rollback',
      // Worker control (P4-M5): cancel/resume touch only the import spine —
      // nothing has committed when they apply, so entity tables are untouched.
      'POST /projects/:id/imports/:jobId/cancel',
      'POST /projects/:id/imports/:jobId/resume',
      // Manual override (M8): one SetField through engine.applyChangeSetWith
      // plus its provenance row — the same spine, fully undoable.
      'POST /projects/:id/provenance/override',
      // Proposal registration (P4-M6): workspace bookkeeping like project
      // CRUD — creates a draft ChangeSet shell, applies nothing. Transitions
      // and the eventual apply go through POST /operations (the engine gate).
      'POST /projects/:id/changesets',
      // Egress door settings (ADR-0027, P4-M1): tool configuration, not model
      // state — no entity table is touched. Guarded by the disclosure gate;
      // every call through the door writes an append-only audit record.
      'PUT /projects/:id/egress/settings',
      // Threat-intel (P4-M2, ADR-0028): the feed is tool configuration; an
      // enrichment fetch writes the import spine only (a synthetic committed
      // job + read-only Evidence) — entity tables are untouched.
      'PUT /projects/:id/threat-intel/feed',
      'POST /projects/:id/enrichments',
      // Privacy & audit (§3.13, improvements M13 #70). Reveal and the
      // retention sweep write only secretMatch/report rows through
      // engine.applyOperation (the engine gate). Purge is the one sanctioned
      // secure-deletion — it drops an evidence blob but preserves the record
      // and its manifest hash, and is audited as a Report record; it is
      // deliberately not undoable (§3.13).
      'POST /projects/:id/secrets/:secretId/reveal',
      'POST /projects/:id/evidence/:evidenceId/purge',
      'POST /projects/:id/retention/sweep',
    ]);

    const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    const routes = app.registeredRoutes.filter((r) => writeMethods.has(r.split(' ')[0] ?? ''));

    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(sanctioned, `unsanctioned write route: ${route}`).toContain(route);
    }
  });
});
