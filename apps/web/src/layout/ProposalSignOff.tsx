import { useCallback, useEffect, useState } from 'react';
import {
  newId,
  operationIdSchema,
  type ChangeSetRecord,
  type ChangeSetReviewStatus,
} from '@netplan/domain';
import { listChangeSets, postOperation, registerChangeSet } from '../api/client';
import { useAppStore } from '../state/store';
import { Button, Spinner } from '../ui';

/**
 * The solo sign-off control (P4-M6, ADR-0026): registered proposal ChangeSets
 * move draft → proposed → approved / rejected through logged Operations; the
 * engine refuses to apply an unapproved proposal. The approver is the single
 * operator — who-may-approve enforcement is a multi-user seam.
 */
export function ProposalSignOff() {
  const project = useAppStore((s) => s.project);
  const pushToast = useAppStore((s) => s.pushToast);
  const invalidateOperationLog = useAppStore((s) => s.invalidateOperationLog);
  const [proposals, setProposals] = useState<ChangeSetRecord[]>([]);
  const [label, setLabel] = useState('');
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) return;
    const all = await listChangeSets(project.id);
    setProposals(all.filter((c) => c.reviewStatus !== null));
  }, [project]);

  useEffect(() => {
    refresh()
      .catch((e: unknown) => pushToast(e instanceof Error ? e.message : 'Failed to load proposals'))
      .finally(() => setLoaded(true));
  }, [refresh, pushToast]);

  if (!project) return null;

  // Register/transition failures are operation results → toast (#99).
  const run = (action: () => Promise<unknown>) => {
    void action()
      .then(() => {
        // review transitions are logged Operations that bypass dispatch —
        // tell the shared log cache its version is stale (#110 D2)
        invalidateOperationLog();
        return refresh();
      })
      .catch((e: unknown) => pushToast(e instanceof Error ? e.message : 'Proposal update failed'));
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
      <div className="proposal-register">
        <input
          data-testid="proposal-label"
          placeholder="New proposal label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button
          data-testid="proposal-register"
          disabled={!label.trim()}
          onClick={() => {
            run(() => registerChangeSet(project.id, label.trim()));
            setLabel('');
          }}
        >
          Register
        </Button>
      </div>
      {!loaded && proposals.length === 0 && (
        <p className="panel-loading">
          <Spinner size="sm" label="Loading proposals" /> Loading proposals…
        </p>
      )}
      <ul data-testid="proposal-list">
        {proposals.map((proposal) => (
          <li key={proposal.id} data-testid={`proposal-${proposal.reviewStatus}`}>
            {proposal.label} —{' '}
            <span className={`proposal-status proposal-status--${proposal.reviewStatus}`}>
              {proposal.reviewStatus}
            </span>
            <span className="proposal-actions">
              {(NEXT[proposal.reviewStatus ?? 'draft'] ?? []).map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={
                    status === 'approved' ? 'primary' : status === 'rejected' ? 'danger' : 'default'
                  }
                  data-testid={`proposal-set-${status}`}
                  onClick={() => transition(proposal, status)}
                >
                  {status === 'proposed' ? 'propose' : status === 'approved' ? 'approve' : 'reject'}
                </Button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
