import { useEffect, useState } from 'react';
import type { OperationLogEntry, ProjectState } from '@netplan/domain';
import { getLog } from '../api/client';
import { ProposalSignOff } from './ProposalSignOff';
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
