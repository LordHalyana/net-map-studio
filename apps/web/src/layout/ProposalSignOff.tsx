import { useCallback, useEffect, useState } from 'react';
import {
  newId,
  operationIdSchema,
  type ChangeSetRecord,
  type ChangeSetReviewStatus,
} from '@netplan/domain';
import { listChangeSets, postOperation, registerChangeSet } from '../api/client';
import { useAppStore } from '../state/store';

/**
 * The solo sign-off control (P4-M6, ADR-0026): registered proposal ChangeSets
 * move draft → proposed → approved / rejected through logged Operations; the
 * engine refuses to apply an unapproved proposal. The approver is the single
 * operator — who-may-approve enforcement is a multi-user seam.
 */
export function ProposalSignOff() {
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
