import { useCallback, useEffect, useState } from 'react';
import {
  newId,
  operationIdSchema,
  type ChangeSetRecord,
  type ChangeSetReviewStatus,
  type OperationLogEntry,
  type ProjectState,
} from '@netplan/domain';
import { getLog, postOperation } from '../api/client';
import { listChangeSets, registerChangeSet } from '../api/egress';
import { useAppStore } from '../state/store';

/**
 * The rendered Diff (ADR-0009, design §3.10): additions are Planned objects,
 * removals are Removed-in-proposal flags, and modifications are field-deltas
 * on the same UUID — read straight from the Operation log's SetField entries,
 * so before/after is exact.
 */
export function DiffPanel() {
  const graph = useAppStore((s) => s.graph);
  const project = useAppStore((s) => s.project);
  const [log, setLog] = useState<OperationLogEntry[]>([]);

  useEffect(() => {
    if (!project) return;
    void getLog(project.id).then(setLog);
  }, [project, graph]);

  if (!graph) return null;

  const named = (state: ProjectState) => [
    ...state.devices.map((d) => ({ id: d.id, name: d.name, type: 'device', lc: d.lifecycleState })),
    ...state.networks.map((n) => ({
      id: n.id,
      name: n.name,
      type: 'network',
      lc: n.lifecycleState,
    })),
    ...state.links.map((l) => ({
      id: l.id,
      name: l.label || l.kind,
      type: 'link',
      lc: l.lifecycleState,
    })),
    ...state.policyRules.map((r) => ({
      id: r.id,
      name: r.name || r.action,
      type: 'policyRule',
      lc: r.lifecycleState,
    })),
  ];
  const entities = named(graph);
  const additions = entities.filter((e) => e.lc === 'planned');
  const removals = entities.filter((e) => e.lc === 'removedInProposal');
  const nameOf = (id: string) => entities.find((e) => e.id === id)?.name ?? id.slice(0, 8);

  // Modifications: field-deltas applied to committed (observed/verified)
  // objects — lifecycle flips are the removals list, not modifications.
  const committedIds = new Set<string>(
    entities.filter((e) => e.lc === 'observed' || e.lc === 'manuallyVerified').map((e) => e.id),
  );
  const modifications = log
    .filter(
      (entry) =>
        entry.role === 'do' &&
        entry.payload.kind === 'SetField' &&
        entry.payload.field !== 'lifecycleState' &&
        entry.payload.field !== 'position' &&
        committedIds.has(entry.payload.entityId),
    )
    .slice(-30)
    .reverse();

  return (
    <div className="diff-panel" data-testid="diff-panel">
      <section>
        <h4>Additions ({additions.length})</h4>
        <ul data-testid="diff-additions">
          {additions.map((e) => (
            <li key={e.id}>
              <span className="diff-badge diff-badge--add">+</span> {e.type} {e.name}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Removals ({removals.length})</h4>
        <ul data-testid="diff-removals">
          {removals.map((e) => (
            <li key={e.id}>
              <span className="diff-badge diff-badge--remove">−</span> {e.type} {e.name}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Modifications ({modifications.length})</h4>
        <ul data-testid="diff-modifications">
          {modifications.map((entry) =>
            entry.payload.kind === 'SetField' ? (
              <li key={entry.id} data-testid="diff-modification">
                <span className="diff-badge diff-badge--mod">Δ</span>{' '}
                {nameOf(entry.payload.entityId)}.{entry.payload.field}:{' '}
                <span className="diff-before">{JSON.stringify(entry.payload.previousValue)}</span>
                {' → '}
                <span className="diff-after">{JSON.stringify(entry.payload.value)}</span>
              </li>
            ) : null,
          )}
        </ul>
      </section>
      <ProposalSignOff />
    </div>
  );
}

/**
 * The solo sign-off control (P4-M6, ADR-0026): registered proposal ChangeSets
 * move draft → proposed → approved / rejected through logged Operations; the
 * engine refuses to apply an unapproved proposal. The approver is the single
 * operator — who-may-approve enforcement is a multi-user seam.
 */
function ProposalSignOff() {
  const project = useAppStore((s) => s.project);
  const [proposals, setProposals] = useState<ChangeSetRecord[]>([]);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!project) return;
    const all = await listChangeSets(project.id);
    setProposals(all.filter((c) => c.reviewStatus !== null));
  }, [project]);

  useEffect(() => {
    refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  if (!project) return null;

  const run = (action: () => Promise<unknown>) => {
    setError(null);
    void action()
      .then(refresh)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const transition = (changeSet: ChangeSetRecord, status: ChangeSetReviewStatus) => {
    run(() =>
      postOperation(project.id, {
        id: newId(operationIdSchema),
        projectId: project.id,
        kind: 'SetChangeSetReviewStatus',
        changeSetId: changeSet.id,
        status,
        note: '',
        // enriched by the engine on apply
        previousStatus: changeSet.reviewStatus ?? 'draft',
        previousNote: changeSet.reviewNote,
      }),
    );
  };

  const NEXT: Partial<Record<ChangeSetReviewStatus, ChangeSetReviewStatus[]>> = {
    draft: ['proposed'],
    proposed: ['approved', 'rejected'],
    rejected: ['proposed'],
  };

  return (
    <section data-testid="proposal-signoff">
      <h4>Proposals ({proposals.length})</h4>
      {error ? (
        <p className="diff-panel__error" data-testid="proposal-error">
          {error}
        </p>
      ) : null}
      <div className="proposal-register">
        <input
          data-testid="proposal-label"
          placeholder="New proposal label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          type="button"
          data-testid="proposal-register"
          disabled={!label.trim()}
          onClick={() => {
            run(() => registerChangeSet(project.id, label.trim()));
            setLabel('');
          }}
        >
          Register
        </button>
      </div>
      <ul data-testid="proposal-list">
        {proposals.map((proposal) => (
          <li key={proposal.id} data-testid={`proposal-${proposal.reviewStatus}`}>
            {proposal.label} —{' '}
            <span className={`proposal-status proposal-status--${proposal.reviewStatus}`}>
              {proposal.reviewStatus}
            </span>
            {(NEXT[proposal.reviewStatus ?? 'draft'] ?? []).map((status) => (
              <button
                key={status}
                type="button"
                data-testid={`proposal-set-${status}`}
                onClick={() => transition(proposal, status)}
              >
                {status === 'proposed' ? 'propose' : status === 'approved' ? 'approve' : 'reject'}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
