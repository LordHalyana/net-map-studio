import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  invertOperation,
  newId,
  operationIdSchema,
  setChangeSetReviewStatusOpSchema,
  type ChangeSetRecord,
} from '@netplan/domain';
import { buildApp } from '../src/app.js';

/**
 * P4-M6 DoD (ADR-0026): an operator can move a proposal ChangeSet to
 * approved — undoably, audited, through the Operation log (I3) — and the
 * AS-IS→TO-BE apply respects the sign-off gate. Multi-user who-may-approve
 * enforcement is a documented seam, not built.
 */

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

async function createProject(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/projects', payload: { name: 'M6' } });
  return res.json().id;
}

async function registerProposal(app: FastifyInstance, projectId: string): Promise<ChangeSetRecord> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/changesets`,
    payload: { label: 'TO-BE: new DMZ segment' },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

function reviewOp(
  projectId: string,
  changeSetId: string,
  status: 'draft' | 'proposed' | 'approved' | 'rejected',
  note = '',
) {
  return {
    id: newId(operationIdSchema),
    projectId,
    kind: 'SetChangeSetReviewStatus',
    changeSetId,
    status,
    note,
    // enriched by the engine on apply; senders provide placeholders
    previousStatus: 'draft',
    previousNote: '',
  };
}

async function transition(
  app: FastifyInstance,
  projectId: string,
  changeSetId: string,
  status: 'draft' | 'proposed' | 'approved' | 'rejected',
  note = '',
) {
  return app.inject({
    method: 'POST',
    url: `/projects/${projectId}/operations`,
    payload: reviewOp(projectId, changeSetId, status, note),
  });
}

function deviceCreateOp(projectId: string) {
  return {
    id: newId(operationIdSchema),
    projectId,
    kind: 'CreateEntity',
    payload: {
      entityType: 'device',
      entity: {
        id: newId(operationIdSchema),
        projectId,
        name: 'dmz-fw',
        deviceType: 'firewall',
        lifecycleState: 'planned',
      },
    },
  };
}

async function applyProposal(app: FastifyInstance, projectId: string, changeSetId: string) {
  return app.inject({
    method: 'POST',
    url: `/projects/${projectId}/operations`,
    payload: {
      id: changeSetId,
      projectId,
      label: 'TO-BE: new DMZ segment',
      operations: [deviceCreateOp(projectId)],
    },
  });
}

describe('P4-M6: proposal registration and the review lifecycle', () => {
  it('registers a proposal shell in draft and lists it', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const proposal = await registerProposal(app, projectId);
    expect(proposal.reviewStatus).toBe('draft');
    expect(proposal.reviewedAt).toBeNull();

    const list: ChangeSetRecord[] = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/changesets` })
      .then((r) => r.json());
    expect(list.map((c) => c.id)).toContain(proposal.id);
  });

  it('moves draft → proposed → approved through logged Operations, note and timestamp recorded', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const proposal = await registerProposal(app, projectId);

    const proposed = await transition(app, projectId, proposal.id, 'proposed', 'ready for review');
    expect(proposed.statusCode).toBe(200);
    const approved = await transition(app, projectId, proposal.id, 'approved', 'looks right');
    expect(approved.statusCode).toBe(200);

    const list: ChangeSetRecord[] = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/changesets` })
      .then((r) => r.json());
    const record = list.find((c) => c.id === proposal.id);
    expect(record?.reviewStatus).toBe('approved');
    expect(record?.reviewNote).toBe('looks right');
    expect(record?.reviewedAt).not.toBeNull();

    // both transitions are rows in the append-only Operation log (I3)
    const log = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/log` })
      .then((r) => r.json());
    const kinds = log.map((e: { kind: string }) => e.kind);
    expect(kinds.filter((k: string) => k === 'SetChangeSetReviewStatus')).toHaveLength(2);
  });

  it('the transition is undoable and redoable like any Operation', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const proposal = await registerProposal(app, projectId);
    await transition(app, projectId, proposal.id, 'proposed');
    await transition(app, projectId, proposal.id, 'approved');

    const statusOf = async () => {
      const list: ChangeSetRecord[] = await app
        .inject({ method: 'GET', url: `/projects/${projectId}/changesets` })
        .then((r) => r.json());
      return list.find((c) => c.id === proposal.id)?.reviewStatus;
    };

    expect(await statusOf()).toBe('approved');
    await app.inject({ method: 'POST', url: `/projects/${projectId}/undo` });
    expect(await statusOf()).toBe('proposed');
    await app.inject({ method: 'POST', url: `/projects/${projectId}/redo` });
    expect(await statusOf()).toBe('approved');
  });

  it('inversion is a pure round-trip on the operation itself', () => {
    const op = setChangeSetReviewStatusOpSchema.parse({
      id: newId(operationIdSchema),
      projectId: newId(operationIdSchema),
      kind: 'SetChangeSetReviewStatus',
      changeSetId: newId(operationIdSchema),
      status: 'approved',
      note: 'ship it',
      previousStatus: 'proposed',
      previousNote: 'pending',
    });
    const inverse = invertOperation(op, newId(operationIdSchema));
    expect(inverse.kind).toBe('SetChangeSetReviewStatus');
    if (inverse.kind === 'SetChangeSetReviewStatus') {
      expect(inverse.status).toBe('proposed');
      expect(inverse.note).toBe('pending');
      const back = invertOperation(inverse, newId(operationIdSchema));
      if (back.kind === 'SetChangeSetReviewStatus') {
        expect(back.status).toBe('approved');
        expect(back.note).toBe('ship it');
      }
    }
  });
});

describe('P4-M6: the sign-off gate', () => {
  it('refuses to apply a registered proposal that is draft, proposed or rejected', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const proposal = await registerProposal(app, projectId);

    for (const status of ['draft', 'proposed', 'rejected'] as const) {
      if (status !== 'draft') await transition(app, projectId, proposal.id, status);
      const res = await applyProposal(app, projectId, proposal.id);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/not approved — sign-off is required/);
    }

    // nothing applied along the way
    const graph = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/graph` })
      .then((r) => r.json());
    expect(graph.devices).toHaveLength(0);
  });

  it('applies once approved — and only once', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const proposal = await registerProposal(app, projectId);
    await transition(app, projectId, proposal.id, 'proposed');
    await transition(app, projectId, proposal.id, 'approved', 'sign-off by operator');

    const res = await applyProposal(app, projectId, proposal.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().state.devices).toHaveLength(1);

    // a second apply of the same approved proposal is refused
    const again = await applyProposal(app, projectId, proposal.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/already applied/);
  });

  it('unregistered ad-hoc ChangeSets keep applying directly (backward compatible)', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/operations`,
      payload: {
        id: newId(operationIdSchema),
        projectId,
        label: 'ad-hoc batch',
        operations: [deviceCreateOp(projectId)],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state.devices).toHaveLength(1);

    const list: ChangeSetRecord[] = await app
      .inject({ method: 'GET', url: `/projects/${projectId}/changesets` })
      .then((r) => r.json());
    expect(list.find((c) => c.label === 'ad-hoc batch')?.reviewStatus).toBeNull();
  });

  it('transitioning an unknown ChangeSet fails with NOT_FOUND', async () => {
    const app = await createApp();
    const projectId = await createProject(app);
    const res = await transition(app, projectId, newId(operationIdSchema), 'approved');
    expect(res.statusCode).toBe(404);
  });
});
