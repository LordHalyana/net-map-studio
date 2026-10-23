import type { ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addressIdSchema,
  deviceIdSchema,
  deviceSchema,
  importProfileIdSchema,
  importProfileSchema,
  interfaceIdSchema,
  newId,
  operationIdSchema,
  projectIdSchema,
  projectStateSchema,
} from '@netplan/domain';
import { buildApp } from '../src/app.js';
import { createWorkerAdapterRunner } from '../src/imports/worker-runner.js';
import { DEFAULT_PARSE_LIMITS, ParseLimitError } from '../src/imports/guards.js';

/**
 * Improvements M12 (#69): adapter execution is isolated in a worker with a
 * hard wall-clock kill and heap cap (§3.5); the netcat-text adapter applies
 * an operator ImportProfile to corroborate an existing device without
 * fabricating topology (§3.6).
 */

/** /proc/<pid>/stat fields after the parenthesised comm: [state, ppid, …]. */
function statFields(pid: number): string[] | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  } catch {
    return null;
  }
}

/** Live and not a zombie awaiting reaping. */
function isRunning(pid: number): boolean {
  const fields = statFields(pid);
  return fields !== null && fields[0] !== 'Z';
}

/** All current descendants of `root`, from the ppid links in /proc. */
function descendantsOf(root: number): number[] {
  const children = new Map<number, number[]>();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const ppid = Number(statFields(Number(entry))?.[1]);
    if (!Number.isFinite(ppid)) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), Number(entry)]);
  }
  const found: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance): Promise<string> {
  const { id } = await app
    .inject({ method: 'POST', url: '/projects', payload: { name: 'M12' } })
    .then((r) => r.json());
  return id;
}

async function getState(app: FastifyInstance, id: string) {
  return projectStateSchema.parse(
    (await app.inject({ method: 'GET', url: `/projects/${id}/graph` })).json(),
  );
}

describe('M12 worker isolation & netcat profiles (#69)', () => {
  it('hard-kills a CPU-bound parse on the wall clock while the app stays responsive', async () => {
    const runner = createWorkerAdapterRunner();
    // netcat-text with a catastrophic-backtracking pattern over a long
    // non-matching line: the adapter does not cooperatively yield inside the
    // regex, so only the worker's hard kill can stop it
    const evil = importProfileSchema.parse({
      id: newId(importProfileIdSchema),
      projectId: newId(projectIdSchema),
      name: 'evil',
      adapter: 'netcat-text',
      pattern: '(?<host>(a+)+$)',
    });
    const started = Date.now();
    const parse = runner({
      adapterName: 'netcat-text',
      content: `${'a'.repeat(40)}b`,
      profile: evil,
      limits: { ...DEFAULT_PARSE_LIMITS, maxParseMillis: 1500 },
    });

    // the main thread keeps working while the worker burns a CPU: a timer
    // scheduled after the parse still fires promptly (the event loop is free)
    const tick = await new Promise<number>((resolve) => {
      const at = Date.now();
      setTimeout(() => resolve(Date.now() - at), 200);
    });
    expect(tick).toBeLessThan(1000);

    await expect(parse).rejects.toBeInstanceOf(ParseLimitError);
    // killed near the wall clock, not left running for minutes
    expect(Date.now() - started).toBeLessThan(6000);
  }, 15_000);

  // #117: the hard kill must end the process that is actually parsing, not
  // just a launcher in front of it — a surviving grandchild spins on the
  // catastrophic regex forever. Reads /proc, so Linux only.
  it.skipIf(process.platform !== 'linux')(
    'the hard kill leaves no worker process behind (#117)',
    async () => {
      let spawned: ChildProcess | undefined;
      const runner = createWorkerAdapterRunner({
        onSpawn: (child) => {
          spawned = child;
        },
      });
      const evil = importProfileSchema.parse({
        id: newId(importProfileIdSchema),
        projectId: newId(projectIdSchema),
        name: 'evil',
        adapter: 'netcat-text',
        pattern: '(?<host>(a+)+$)',
      });
      let settled = false;
      // capture the outcome now: the rejection lands while we are sampling
      const outcome = runner({
        adapterName: 'netcat-text',
        content: `${'a'.repeat(40)}b`,
        profile: evil,
        limits: { ...DEFAULT_PARSE_LIMITS, maxParseMillis: 1500 },
      }).then(
        () => null,
        (error: unknown) => error,
      );
      void outcome.finally(() => {
        settled = true;
      });

      // every process the worker launch produced, sampled until the kill
      const seen = new Set<number>();
      while (!settled) {
        if (spawned?.pid) {
          seen.add(spawned.pid);
          for (const pid of descendantsOf(spawned.pid)) seen.add(pid);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await outcome).toBeInstanceOf(ParseLimitError);
      expect(seen.size).toBeGreaterThan(0);

      // give the OS a moment to reap, then nothing may still be running
      const deadline = Date.now() + 2000;
      let survivors = [...seen].filter(isRunning);
      while (survivors.length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        survivors = survivors.filter(isRunning);
      }
      for (const pid of survivors) process.kill(pid, 'SIGKILL'); // don't leak into later tests
      expect(survivors).toEqual([]);
    },
    15_000,
  );

  it('a huge single line fails the job without crashing the server', async () => {
    const app = await createApp();
    const id = await createProject(app);

    // one 40MB line under the fixture adapter's JSON parser — bounded, fails
    const huge = JSON.stringify({ devices: [{ name: 'x'.repeat(40 * 1024 * 1024) }] });
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${id}/imports`,
      payload: { filename: 'huge.json', adapter: 'fixture', content: huge },
    });
    // ingest may 413 at the size guard, or accept then fail the job — either
    // way the server survives and answers the next request
    if (res.statusCode === 202) {
      await app.importStore.whenIdle();
    }
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
  }, 20_000);

  it('netcat-text + a profile corroborates an existing device, never fabricating one', async () => {
    const app = await createApp();
    const id = await createProject(app);

    // a committed device with the IP the scan will reference
    const device = deviceSchema.parse({
      id: newId(deviceIdSchema),
      projectId: id,
      name: 'web01',
      deviceType: 'server',
    });
    await app.inject({
      method: 'POST',
      url: `/projects/${id}/operations`,
      payload: {
        id: newId(operationIdSchema),
        projectId: id,
        kind: 'CreateEntity',
        payload: { entityType: 'device', entity: device },
      },
    });
    // …an interface carrying that IP, so the netcat claim correlates to this
    // committed device instead of inventing a new one (the pipeline matches
    // a device by its addresses)
    const iface = {
      id: newId(interfaceIdSchema),
      projectId: id,
      deviceId: device.id,
      name: 'eth0',
    };
    const create = (entityType: string, entity: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `/projects/${id}/operations`,
        payload: {
          id: newId(operationIdSchema),
          projectId: id,
          kind: 'CreateEntity',
          payload: { entityType, entity },
        },
      });
    expect((await create('interface', iface)).statusCode).toBe(200);
    expect(
      (
        await create('address', {
          id: newId(addressIdSchema),
          projectId: id,
          interfaceId: iface.id,
          kind: 'ipv4',
          value: '10.0.0.5',
        })
      ).statusCode,
    ).toBe(200);

    // the operator's ImportProfile — named groups are the field map
    const profile = importProfileSchema.parse({
      id: newId(importProfileIdSchema),
      projectId: id,
      name: 'nmap-grep',
      adapter: 'netcat-text',
      pattern:
        '^(?<host>\\d+\\.\\d+\\.\\d+\\.\\d+)\\s+(?<port>\\d+)\\s+(?<status>open|closed)(?:\\s+(?<banner>.*))?$',
    });
    await app.inject({
      method: 'POST',
      url: `/projects/${id}/operations`,
      payload: {
        id: newId(operationIdSchema),
        projectId: id,
        kind: 'CreateEntity',
        payload: { entityType: 'importProfile', entity: profile },
      },
    });

    const log = ['10.0.0.5 443 open nginx/1.24', '10.0.0.5 22 closed', 'garbage line'].join('\n');
    const importRes = await app.inject({
      method: 'POST',
      url: `/projects/${id}/imports`,
      payload: {
        filename: 'scan.txt',
        adapter: 'netcat-text',
        content: log,
        profileId: profile.id,
      },
    });
    expect(importRes.statusCode).toBe(202);
    const job = importRes.json();
    await app.importStore.whenIdle();

    const detail = await app
      .inject({ method: 'GET', url: `/projects/${id}/imports/${job.id}` })
      .then((r) => r.json());
    expect(detail.job.status).toBe('review');

    const svcObs = detail.observations.filter(
      (o: { claim: { targetKind: string } }) => o.claim.targetKind === 'service',
    );
    // only the "open" line yields a service; "closed" and garbage do not
    expect(svcObs).toHaveLength(1);
    expect(svcObs[0].claim.port).toBe(443);
    // §3.7: a banner-bearing single text result is low-confidence
    expect(svcObs[0].contributor).toBe('bannerInference');

    // the IP match surfaces as a device conflict — the system never silently
    // merges (§3.7); resolving it as a merge corroborates the existing web01
    const conflicts: { id: string; entityType: string }[] = detail.proposal.conflicts;
    for (const conflict of conflicts.filter((c) => c.entityType === 'device')) {
      await app.inject({
        method: 'POST',
        url: `/projects/${id}/imports/${job.id}/resolve`,
        payload: { conflictId: conflict.id, action: 'merge' },
      });
    }
    await app.inject({ method: 'POST', url: `/projects/${id}/imports/${job.id}/commit` });
    const committed = await getState(app, id);
    expect(committed.devices).toHaveLength(1); // corroborated, not fabricated
    expect(committed.services.some((s) => s.deviceId === device.id && s.portStart === 443)).toBe(
      true,
    );
  }, 20_000);

  it('netcat-text refuses to run without a profile', async () => {
    const app = await createApp();
    const id = await createProject(app);
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${id}/imports`,
      payload: { filename: 'scan.txt', adapter: 'netcat-text', content: '1.2.3.4 80 open' },
    });
    expect(res.statusCode).toBe(202);
    await app.importStore.whenIdle();
    const detail = await app
      .inject({ method: 'GET', url: `/projects/${id}/imports/${res.json().id}` })
      .then((r) => r.json());
    expect(detail.job.status).toBe('failed');
    expect(detail.job.error).toContain('ImportProfile');
  }, 20_000);
});
