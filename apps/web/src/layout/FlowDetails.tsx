import { endpointResolver, type ProjectState } from '@netplan/domain';
import { useAppStore } from '../state/store';

/**
 * FLOW DETAILS view of the context panel (M3, #60). Flows are evidence-derived
 * (§3.7) — this view is strictly read-only: kind, endpoints, service, count,
 * first/last seen, confidence and evidence provenance.
 */

function formatSeen(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function FlowDetails({ flowIds, graph }: { flowIds: string[]; graph: ProjectState }) {
  const provenance = useAppStore((s) => s.provenance);
  const setView = useAppStore((s) => s.setView);
  const endpoints = endpointResolver(graph);
  const flows = graph.flows.filter((f) => flowIds.includes(f.id));
  if (flows.length === 0) return null;

  return (
    <div data-testid="flow-details">
      {flows.length > 1 && (
        <p data-testid="flow-bundle-summary">
          Bundled edge — {flows.length} aggregated flows between this device pair:
        </p>
      )}
      <ul className="flow-list">
        {flows.map((flow) => {
          const service = flow.serviceId
            ? graph.services.find((s) => s.id === flow.serviceId)
            : undefined;
          const evidenceIds = [
            ...new Set(
              provenance
                .filter((row) => row.entityType === 'flow' && row.entityId === flow.id)
                .flatMap((row) => (row.evidenceId ? [row.evidenceId] : [])),
            ),
          ];
          return (
            <li key={flow.id} className="flow-list__item" data-testid={`flow-item-${flow.id}`}>
              <dl className="flow-detail">
                <dt>Observed</dt>
                <dd data-testid="flow-endpoints">
                  {endpoints.label(flow.source)} → {endpoints.label(flow.destination)}
                </dd>
                <dt>Service</dt>
                <dd data-testid="flow-service">
                  {flow.protocol.toUpperCase()}
                  {flow.port !== null ? `/${flow.port}` : ''}
                  {service ? ` · ${service.name}` : ''}
                </dd>
                <dt>Observations</dt>
                <dd data-testid="flow-count">×{flow.observationCount}</dd>
                <dt>First seen</dt>
                <dd>{formatSeen(flow.firstSeen)}</dd>
                <dt>Last seen</dt>
                <dd>{formatSeen(flow.lastSeen)}</dd>
                <dt>Confidence</dt>
                <dd data-testid="flow-confidence">{(flow.confidence * 100).toFixed(0)}%</dd>
                <dt>Evidence</dt>
                <dd data-testid="flow-evidence">
                  {evidenceIds.length > 0 ? (
                    <button
                      type="button"
                      className="flow-evidence-link"
                      onClick={() => setView('imports')}
                      title="Open the Imports view to inspect the evidence"
                    >
                      {evidenceIds.length} evidence file{evidenceIds.length > 1 ? 's' : ''}
                    </button>
                  ) : (
                    '—'
                  )}
                </dd>
              </dl>
            </li>
          );
        })}
      </ul>
      <p className="panel-empty">Flows are derived from evidence and cannot be edited.</p>
    </div>
  );
}
