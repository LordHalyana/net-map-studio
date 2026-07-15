import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { EgressAuditRecord, EgressSettings } from '@netplan/domain';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { EgressBlockedError, createEgressDoor, type EgressProvider } from '../src/egress/door.js';
import { stubProvider } from '../src/egress/providers/stub.js';
import { makeProject } from '@netplan/domain/fixtures';
import { projects } from '../src/db/schema.js';

/**
 * M1 DoD (plan §2, ADR-0027): the egress door is the single guarded chokepoint.
 * Off by default ⇒ provably zero outbound packets; on (post-disclosure) a stub
 * call writes exactly one audit record; no network client exists outside the
 * door module.
 */

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance): Promise<{ id: string }> {
  const res = await app.inject({ method: 'POST', url: '/projects', payload: { name: 'P4' } });
  expect(res.statusCode).toBe(201);
  return res.json();
}

const HASH = 'ab'.repeat(32);

describe('M1: egress settings & the disclosure gate', () => {
  it('every project starts with the door shut: disabled, hash-first, unacknowledged', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/egress/settings`,
    });
    expect(res.statusCode).toBe(200);
    const settings: EgressSettings = res.json();
    expect(settings.enabled).toBe(false);
    expect(settings.disclosureAcknowledgedAt).toBeNull();
    expect(settings.allowedIndicatorTypes).toEqual(['fileHash']);
  });

  it('refuses to enable egress without the disclosure acknowledgment', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${project.id}/egress/settings`,
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/disclosure/i);

    // and the door stayed shut
    const settings: EgressSettings = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/egress/settings` })
      .then((r) => r.json());
    expect(settings.enabled).toBe(false);
  });

  it('enables egress behind an acknowledged disclosure and stamps the acknowledgment', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${project.id}/egress/settings`,
      payload: { enabled: true, acknowledgeDisclosure: true },
    });
    expect(res.statusCode).toBe(200);
    const settings: EgressSettings = res.json();
    expect(settings.enabled).toBe(true);
    expect(settings.disclosureAcknowledgedAt).not.toBeNull();
    expect(settings.allowedIndicatorTypes).toEqual(['fileHash']);
  });

  it('gates each sensitive indicator type behind its own explicit opt-in (Q10)', async () => {
    const app = await createApp();
    const project = await createProject(app);
    await app.inject({
      method: 'PUT',
      url: `/projects/${project.id}/egress/settings`,
      payload: { enabled: true, acknowledgeDisclosure: true },
    });

    // widening to ip without re-acknowledging the (updated) disclosure fails
    const widen = await app.inject({
      method: 'PUT',
      url: `/projects/${project.id}/egress/settings`,
      payload: { enabled: true, allowedIndicatorTypes: ['fileHash', 'ip'] },
    });
    expect(widen.statusCode).toBe(400);

    const acknowledged = await app.inject({
      method: 'PUT',
      url: `/projects/${project.id}/egress/settings`,
      payload: {
        enabled: true,
        allowedIndicatorTypes: ['fileHash', 'ip'],
        acknowledgeDisclosure: true,
      },
    });
    expect(acknowledged.statusCode).toBe(200);
    expect(acknowledged.json().allowedIndicatorTypes).toEqual(['fileHash', 'ip']);
  });

  it('disabling the door needs no acknowledgment', async () => {
    const app = await createApp();
    const project = await createProject(app);
    await app.inject({
      method: 'PUT',
      url: `/projects/${project.id}/egress/settings`,
      payload: { enabled: true, acknowledgeDisclosure: true },
    });
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${project.id}/egress/settings`,
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
  });
});

describe('M1: the door blocks, audits and executes', () => {
  function createDoor(providers?: EgressProvider[]) {
    const { db } = createDb(':memory:');
    const project = makeProject();
    db.insert(projects).values(project).run();
    const door = createEgressDoor(db, { providers: providers ?? [stubProvider] });
    return { db, door, project };
  }

  it('with egress off, a stub call is blocked before the provider runs and audited as blocked', async () => {
    let executed = 0;
    const spyProvider: EgressProvider = {
      id: 'stub',
      version: '0.0.0',
      requiresEgress: true,
      execute: async () => {
        executed += 1;
        return { raw: '{}', response: { verdict: 'unknown', score: null, detail: '' } };
      },
    };
    const { door, project } = createDoor([spyProvider]);

    await expect(
      door.call(project.id, 'stub', { indicatorType: 'fileHash', query: HASH }),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    expect(executed).toBe(0);

    const audit = door.listAudit(project.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.outcome).toBe('blocked');
    expect(audit[0]?.query).toBe(HASH);
  });

  it('with egress on (post-disclosure), a stub call succeeds and writes exactly one audit record', async () => {
    const { door, project } = createDoor();
    door.updateSettings(project.id, { enabled: true, acknowledgeDisclosure: true });

    const result = await door.call(project.id, 'stub', {
      indicatorType: 'fileHash',
      query: HASH,
    });
    expect(result.raw).toContain(HASH);

    const audit = door.listAudit(project.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      providerId: 'stub',
      indicatorType: 'fileHash',
      query: HASH,
      outcome: 'success',
    });
  });

  it('an indicator type outside the per-type opt-in is blocked even with egress on', async () => {
    const { door, project } = createDoor();
    door.updateSettings(project.id, { enabled: true, acknowledgeDisclosure: true });

    await expect(
      door.call(project.id, 'stub', { indicatorType: 'ip', query: '203.0.113.7' }),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    const audit = door.listAudit(project.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.outcome).toBe('blocked');
    expect(audit[0]?.indicatorType).toBe('ip');

    door.updateSettings(project.id, {
      enabled: true,
      allowedIndicatorTypes: ['fileHash', 'ip'],
      acknowledgeDisclosure: true,
    });
    const result = await door.call(project.id, 'stub', {
      indicatorType: 'ip',
      query: '203.0.113.7',
    });
    expect(result.raw).not.toBe('');
  });

  it('a provider failure is audited as an error', async () => {
    const failing: EgressProvider = {
      id: 'stub',
      version: '0.0.0',
      requiresEgress: true,
      execute: async () => {
        throw new Error('provider exploded');
      },
    };
    const { door, project } = createDoor([failing]);
    door.updateSettings(project.id, { enabled: true, acknowledgeDisclosure: true });

    await expect(
      door.call(project.id, 'stub', { indicatorType: 'fileHash', query: HASH }),
    ).rejects.toThrow('provider exploded');
    const audit = door.listAudit(project.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.outcome).toBe('error');
    expect(audit[0]?.detail).toContain('provider exploded');
  });

  it('exposes the audit trail per project over the API', async () => {
    const app = await createApp();
    const project = await createProject(app);
    await app.inject({
      method: 'PUT',
      url: `/projects/${project.id}/egress/settings`,
      payload: { enabled: true, acknowledgeDisclosure: true },
    });
    await app.egressDoor.call(project.id, 'stub', { indicatorType: 'fileHash', query: HASH });

    const res = await app.inject({ method: 'GET', url: `/projects/${project.id}/egress/audit` });
    expect(res.statusCode).toBe(200);
    const records: EgressAuditRecord[] = res.json();
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe('success');
  });
});

describe('M1 DoD: egress off ⇒ zero outbound packets', () => {
  const attempts: string[] = [];
  const originalConnect = net.Socket.prototype.connect;
  const originalDgramSend = dgram.Socket.prototype.send;

  beforeAll(() => {
    net.Socket.prototype.connect = function patchedConnect(): never {
      attempts.push('net.Socket.connect');
      throw new Error('outbound TCP attempt during zero-egress test');
    } as unknown as typeof net.Socket.prototype.connect;
    dgram.Socket.prototype.send = function patchedSend(): never {
      attempts.push('dgram.Socket.send');
      throw new Error('outbound UDP attempt during zero-egress test');
    } as unknown as typeof dgram.Socket.prototype.send;
  });

  afterAll(() => {
    net.Socket.prototype.connect = originalConnect;
    dgram.Socket.prototype.send = originalDgramSend;
  });

  it('a full workflow with the door shut opens no sockets, and a lookup attempt is blocked', async () => {
    const app = await createApp();
    const project = await createProject(app);

    // representative workflow: import → review → commit → findings → report
    const upload = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports`,
      payload: {
        filename: 'fixture.json',
        adapter: 'fixture',
        content: JSON.stringify({
          fixture: true,
          devices: [{ name: 'web01', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.10' }],
        }),
      },
    });
    expect(upload.statusCode).toBe(202);
    await app.importStore.whenIdle();
    const job = upload.json();
    const commit = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${job.id}/commit`,
    });
    expect(commit.statusCode).toBe(200);
    const findings = await app.inject({ method: 'GET', url: `/projects/${project.id}/findings` });
    expect(findings.statusCode).toBe(200);
    const report = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/report/findings`,
    });
    expect(report.statusCode).toBe(200);

    // even asking for egress is a no-packet event with the door shut
    await expect(
      app.egressDoor.call(project.id, 'stub', { indicatorType: 'fileHash', query: HASH }),
    ).rejects.toBeInstanceOf(EgressBlockedError);

    expect(attempts).toEqual([]);
  });

  it('the stub provider is canned — even with egress on, no packet leaves', async () => {
    const app = await createApp();
    const project = await createProject(app);
    await app.inject({
      method: 'PUT',
      url: `/projects/${project.id}/egress/settings`,
      payload: { enabled: true, acknowledgeDisclosure: true },
    });
    const result = await app.egressDoor.call(project.id, 'stub', {
      indicatorType: 'fileHash',
      query: HASH,
    });
    expect(result.raw).not.toBe('');
    expect(attempts).toEqual([]);
  });
});

describe('M1 DoD: no network client exists in server code outside the door module', () => {
  const SERVER_SRC = join(__dirname, '..', 'src');
  const DOOR_DIR = ['egress'];
  const FORBIDDEN: Array<[string, RegExp]> = [
    // bare fetch( only — a method named .fetch( is not a network client
    ['global fetch call', /(?<![.\w])fetch\s*\(/],
    ['globalThis.fetch call', /globalThis\.fetch/],
    ['node:http(s) import', /from ['"]node:https?['"]/],
    ['node:net import', /from ['"]node:net['"]/],
    ['node:tls import', /from ['"]node:tls['"]/],
    ['node:dgram import', /from ['"]node:dgram['"]/],
    ['node:dns import', /from ['"]node:dns['"]/],
    ['undici import', /['"]undici['"]/],
    ['axios import', /['"]axios['"]/],
    ['WebSocket client', /new WebSocket\s*\(/],
  ];

  function listSourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return listSourceFiles(full);
      return entry.endsWith('.ts') ? [full] : [];
    });
  }

  it('scans every server source file outside src/egress for network clients', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SERVER_SRC)) {
      const rel = relative(SERVER_SRC, file);
      if (DOOR_DIR.includes(rel.split(sep)[0] ?? '')) continue;
      const source = readFileSync(file, 'utf8');
      for (const [label, pattern] of FORBIDDEN) {
        if (pattern.test(source)) offenders.push(`${rel}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
