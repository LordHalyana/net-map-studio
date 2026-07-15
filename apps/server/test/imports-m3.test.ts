import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  FieldProvenance,
  ImportJob,
  ImportProposal,
  Observation,
  OperationLogEntry,
  ProjectState,
} from '@netplan/domain';
import { buildApp } from '../src/app.js';

/**
 * M3 DoD (plan §2, ADR-0021): propose → resolve → commit → rollback, all
 * through the one Operation-log spine. Also proves the M2 invariant: the
 * denormalized entity value equals the winning provenance row.
 */

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance): Promise<{ id: string }> {
  const res = await app.inject({ method: 'POST', url: '/projects', payload: { name: 'P2' } });
  return res.json();
}

interface JobDetail {
  job: ImportJob;
  observations: Observation[];
  proposal: ImportProposal | null;
}

async function importFixture(
  app: FastifyInstance,
  projectId: string,
  devices: Record<string, unknown>[],
): Promise<JobDetail> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/imports`,
    payload: {
      filename: 'fixture.json',
      adapter: 'fixture',
      content: JSON.stringify({ fixture: true, devices }),
    },
  });
  expect(res.statusCode).toBe(202);
  const job: ImportJob = res.json();
  await app.importStore.whenIdle();
  return app
    .inject({ method: 'GET', url: `/projects/${projectId}/imports/${job.id}` })
    .then((r) => r.json());
}

async function getState(app: FastifyInstance, projectId: string): Promise<ProjectState> {
  return app.inject({ method: 'GET', url: `/projects/${projectId}/graph` }).then((r) => r.json());
}

async function getLog(app: FastifyInstance, projectId: string): Promise<OperationLogEntry[]> {
  return app.inject({ method: 'GET', url: `/projects/${projectId}/log` }).then((r) => r.json());
}

const WEB01 = { name: 'web01', mac: 'aa:bb:cc:00:00:01', ip: '10.0.0.10', hostname: 'web01' };

describe('M3: commit against an empty graph', () => {
  it('applies the proposed ChangeSet: Observed entities, logged as one unit, with provenance', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const detail = await importFixture(app, project.id, [
      WEB01,
      { name: 'db01', stableId: 'm-db01', ip: '10.0.0.20', os: 'Debian 12' },
    ]);

    expect(detail.job.status).toBe('review');
    expect(detail.proposal).not.toBeNull();
    expect(detail.proposal!.conflicts).toEqual([]);

    // nothing is applied while the ChangeSet is pending
    expect((await getState(app, project.id)).devices).toHaveLength(0);

    const commit = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${detail.job.id}/commit`,
    });
    expect(commit.statusCode).toBe(200);
    const committed: { job: ImportJob; state: ProjectState } = commit.json();
    expect(committed.job.status).toBe('committed');
    expect(committed.job.changeSetId).toBe(detail.proposal!.changeSetId);

    const state = await getState(app, project.id);
    expect(state.devices).toHaveLength(2);
    expect(state.devices.every((d) => d.lifecycleState === 'observed')).toBe(true);
    expect(state.addresses.length).toBeGreaterThanOrEqual(3);

    // every mutation went through the Operation log, grouped by the ChangeSet
    const log = await getLog(app, project.id);
    const changeSetEntries = log.filter(
      (e) => e.changeSetId === detail.proposal!.changeSetId && e.role === 'do',
    );
    expect(changeSetEntries).toHaveLength(detail.proposal!.operations.length);
    // and no entity landed outside it
    const createdIds = changeSetEntries
      .filter((e) => e.kind === 'CreateEntity')
      .map((e) => (e.payload.kind === 'CreateEntity' ? e.payload.payload.entity.id : ''));
    for (const device of state.devices) expect(createdIds).toContain(device.id);

    // M2 invariant: the denormalized value equals the winning provenance row
    const db01 = state.devices.find((d) => d.name === 'db01')!;
    const provenance: FieldProvenance[] = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/provenance/device/${db01.id}` })
      .then((r) => r.json());
    const osRows = provenance.filter((r) => r.field === 'os');
    expect(osRows.length).toBeGreaterThan(0);
    const winning = osRows.find((r) => r.status === 'accepted')!;
    expect(winning.observedValue).toBe(db01.os);
    expect(winning.evidenceId).not.toBeNull();
    expect(winning.importJobId).toBe(detail.job.id);
  });

  it('refuses to commit while a conflict is pending — the queue never auto-merges', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const first = await importFixture(app, project.id, [WEB01]);
    await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${first.job.id}/commit`,
    });

    const second = await importFixture(app, project.id, [{ ...WEB01, os: 'Ubuntu 24.04' }]);
    expect(second.proposal!.conflicts).toHaveLength(1);
    expect(second.proposal!.conflicts[0]!.resolution).toBe('pending');

    const commit = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${second.job.id}/commit`,
    });
    expect(commit.statusCode).toBe(409);
    expect(commit.json().error).toMatch(/never auto-merges/);
  });
});

describe('M3: resolutions rewrite the pending ChangeSet', () => {
  async function overlappingImport(app: FastifyInstance, projectId: string) {
    const first = await importFixture(app, projectId, [WEB01]);
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imports/${first.job.id}/commit`,
    });
    const stateAfterFirst = await getState(app, projectId);
    const existingDevice = stateAfterFirst.devices[0]!;
    const second = await importFixture(app, projectId, [{ ...WEB01, os: 'Ubuntu 24.04' }]);
    return { existingDevice, second };
  }

  it('merge commits SetFields onto the existing object (one device, provenance from both imports)', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const { existingDevice, second } = await overlappingImport(app, project.id);

    const conflict = second.proposal!.conflicts[0]!;
    const resolve = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${second.job.id}/resolve`,
      payload: { conflictId: conflict.id, action: 'merge' },
    });
    expect(resolve.statusCode).toBe(200);
    const rewritten: ImportProposal = resolve.json();
    expect(
      rewritten.operations.some(
        (o) => o.kind === 'CreateEntity' && o.payload.entityType === 'device',
      ),
    ).toBe(false);
    const setOs = rewritten.operations.find((o) => o.kind === 'SetField' && o.field === 'os');
    expect(setOs).toBeDefined();

    const commit = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${second.job.id}/commit`,
    });
    expect(commit.statusCode).toBe(200);

    const state = await getState(app, project.id);
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0]!.id).toBe(existingDevice.id);
    expect(state.devices[0]!.os).toBe('Ubuntu 24.04');

    // provenance now carries rows from both import jobs
    const provenance: FieldProvenance[] = await app
      .inject({
        method: 'GET',
        url: `/projects/${project.id}/provenance/device/${existingDevice.id}`,
      })
      .then((r) => r.json());
    const jobs = new Set(provenance.map((r) => r.importJobId));
    expect(jobs.size).toBe(2);
  });

  it('ignore drops the imported candidate entirely', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const { second } = await overlappingImport(app, project.id);

    await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${second.job.id}/resolve`,
      payload: { conflictId: second.proposal!.conflicts[0]!.id, action: 'ignore' },
    });
    const commit = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${second.job.id}/commit`,
    });
    expect(commit.statusCode).toBe(200);
    const state = await getState(app, project.id);
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0]!.os).toBe(''); // untouched
  });

  it('keep-separate commits a second device', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const { second } = await overlappingImport(app, project.id);

    await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${second.job.id}/resolve`,
      payload: { conflictId: second.proposal!.conflicts[0]!.id, action: 'keepSeparate' },
    });
    await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${second.job.id}/commit`,
    });
    expect((await getState(app, project.id)).devices).toHaveLength(2);
  });
});

describe('M3: rollback inverts the whole ChangeSet atomically', () => {
  it('removes the imported objects, their provenance, and audits the inversion', async () => {
    const app = await createApp();
    const project = await createProject(app);
    const detail = await importFixture(app, project.id, [WEB01, { name: 'db01', ip: '10.0.0.20' }]);
    await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${detail.job.id}/commit`,
    });
    const committedState = await getState(app, project.id);
    expect(committedState.devices).toHaveLength(2);
    const deviceId = committedState.devices[0]!.id;

    const rollback = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${detail.job.id}/rollback`,
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().job.status).toBe('rolledBack');

    const state = await getState(app, project.id);
    expect(state.devices).toHaveLength(0);
    expect(state.addresses).toHaveLength(0);
    expect(state.interfaces).toHaveLength(0);

    const provenance = await app
      .inject({ method: 'GET', url: `/projects/${project.id}/provenance/device/${deviceId}` })
      .then((r) => r.json());
    expect(provenance).toEqual([]);

    // the inversion itself is audited: log grew, nothing was erased
    const log = await getLog(app, project.id);
    const dos = log.filter((e) => e.role === 'do');
    expect(dos.length).toBe(detail.proposal!.operations.length * 2);

    // rolling back twice is refused
    const again = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/imports/${detail.job.id}/rollback`,
    });
    expect(again.statusCode).toBe(409);
  });
});
