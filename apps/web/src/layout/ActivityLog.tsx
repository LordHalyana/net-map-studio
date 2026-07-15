import { useEffect, useState } from 'react';
import type { Operation, OperationLogEntry } from '@netplan/domain';
import { getLog } from '../api/client';
import { useAppStore } from '../state/store';

function describeOperation(op: Operation): string {
  switch (op.kind) {
    case 'CreateEntity':
      return `Create ${op.payload.entityType} “${'name' in op.payload.entity ? op.payload.entity.name : op.payload.entity.id}”`;
    case 'DeleteEntity':
      return `Delete ${op.payload.entityType} “${'name' in op.payload.entity ? op.payload.entity.name : op.payload.entity.id}”`;
    case 'SetField':
      return `Set ${op.entityType}.${op.field}`;
    case 'CreateLink':
      return `Create link ${op.link.label || op.link.kind}`;
    case 'DeleteLink':
      return `Delete link ${op.snapshot.label || op.snapshot.kind}`;
    case 'CreatePolicyRule':
      return `Create ${op.rule.action} rule`;
    case 'DeletePolicyRule':
      return `Delete ${op.snapshot.action} rule`;
    case 'SetMembership':
      return op.networkId ? 'Assign interface to network' : 'Clear interface network';
    case 'SetContainment':
      return op.zoneId ? 'Place device in zone' : 'Remove device from zone';
    case 'SetFindingStatus':
      return `Set finding status to ${op.status}`;
    case 'SetFindingNote':
      return 'Edit finding note';
    case 'SetChangeSetReviewStatus':
      return `Set proposal review status to ${op.status}`;
  }
}

const roleGlyph = { do: '●', undo: '⤺', redo: '⤻' };

/** The audit trail rendered from the append-only operation log (ADR-0010). */
export function ActivityLog() {
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const availability = useAppStore((s) => s.availability);
  const [entries, setEntries] = useState<OperationLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // graph/availability change whenever an operation lands — refetch then.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    getLog(project.id)
      .then((log) => {
        if (!cancelled) setEntries(log);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load log');
      });
    return () => {
      cancelled = true;
    };
  }, [project, graph, availability]);

  if (error) return <p className="panel-empty">⚠ {error}</p>;
  if (entries.length === 0) return <p className="panel-empty">No operations yet.</p>;

  return (
    <ol className="activity-log" data-testid="activity-log">
      {entries
        .slice()
        .reverse()
        .map((entry) => (
          <li key={entry.seq} className={`activity-log__row activity-log__row--${entry.role}`}>
            <span className="activity-log__seq">#{entry.seq}</span>
            <span className="activity-log__role" title={entry.role}>
              {roleGlyph[entry.role]}
            </span>
            <span className="activity-log__text">{describeOperation(entry.payload)}</span>
            {entry.changeSetId && (
              <span className="activity-log__changeset" title={`ChangeSet ${entry.changeSetId}`}>
                ⛓
              </span>
            )}
            <span className="activity-log__time">
              {new Date(entry.createdAt).toLocaleTimeString()}
            </span>
          </li>
        ))}
    </ol>
  );
}
