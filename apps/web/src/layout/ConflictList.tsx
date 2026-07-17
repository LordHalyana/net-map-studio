import type { ImportResolutionAction } from '@netplan/domain';
import { useAppStore } from '../state/store';

const ACTIONS: { action: ImportResolutionAction; label: string; hint: string }[] = [
  {
    action: 'merge',
    label: 'Merge',
    hint: 'Same object: fill gaps, existing values win conflicts',
  },
  { action: 'keepSeparate', label: 'Keep separate', hint: 'Import as a new, distinct object' },
  { action: 'replace', label: 'Replace', hint: 'Same object: imported values win conflicts' },
  { action: 'ignore', label: 'Ignore', hint: 'Drop this candidate from the import' },
];

/**
 * Import reconciliation conflicts (design §3.2E, ADR-0021): candidate,
 * matching existing object, conflicting values, proposed action. Each choice
 * rewrites the pending ChangeSet; the system never merges on its own.
 */
export function ConflictList() {
  const selected = useAppStore((s) => s.selectedImport);
  const resolveConflict = useAppStore((s) => s.resolveConflict);
  const graph = useAppStore((s) => s.graph);
  const conflicts = selected?.proposal?.conflicts ?? [];

  if (selected?.job.status !== 'review') {
    return <p className="panel-empty">Select an import job in review to see its conflicts.</p>;
  }
  if (conflicts.length === 0) {
    return (
      <p className="panel-empty" data-testid="conflicts-empty">
        No reconciliation conflicts — every candidate is new.
      </p>
    );
  }

  const existingName = (entityType: string, id: string): string => {
    if (!graph) return id;
    if (entityType === 'device') return graph.devices.find((d) => d.id === id)?.name ?? id;
    if (entityType === 'identity') return graph.identities.find((i) => i.id === id)?.name ?? id;
    return id.slice(0, 8);
  };

  return (
    <ul className="conflict-list" data-testid="conflict-list">
      {conflicts.map((conflict) => (
        <li
          key={conflict.id}
          className={`conflict${conflict.resolution === 'pending' ? ' conflict--pending' : ''}`}
          data-testid={`conflict-${conflict.entityType}`}
        >
          <div className="conflict__summary">{conflict.summary}</div>
          <div className="conflict__existing">
            Existing: {existingName(conflict.entityType, conflict.existingEntityId)}
          </div>
          {conflict.fieldDiffs.length > 0 && (
            <table className="conflict__diffs" data-testid="conflict-diffs">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Existing</th>
                  <th>Imported</th>
                </tr>
              </thead>
              <tbody>
                {conflict.fieldDiffs.map((diff) => (
                  <tr key={diff.field}>
                    <td>{diff.field}</td>
                    <td>{JSON.stringify(diff.existingValue)}</td>
                    <td>{JSON.stringify(diff.proposedValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {conflict.resolution === 'pending' ? (
            <div className="conflict__actions">
              {ACTIONS.map(({ action, label, hint }) => (
                <button
                  key={action}
                  type="button"
                  title={hint}
                  data-testid={`resolve-${action}`}
                  onClick={() => void resolveConflict(conflict.id, action)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div className="conflict__resolution" data-testid="conflict-resolution">
              Resolved: {conflict.resolution}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
