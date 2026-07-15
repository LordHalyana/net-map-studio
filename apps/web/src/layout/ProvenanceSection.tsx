import { useEffect, useState } from 'react';
import type { Evidence, FieldProvenance } from '@netplan/domain';
import { listEvidence, overrideField } from '../api/imports';
import { useAppStore } from '../state/store';

/**
 * Per-field provenance (ADR-0008, plan M8, acceptance #6): for each imported
 * field — source type, Evidence reference, confidence and status. The
 * override control writes a manual provenance row plus a SetField Operation
 * through the engine, so it is undoable like any other edit.
 */
export function ProvenanceSection({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const project = useAppStore((s) => s.project);
  const provenance = useAppStore((s) => s.provenance);
  const refreshProvenance = useAppStore((s) => s.refreshProvenance);
  const reload = useAppStore((s) => s.reload);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [overriding, setOverriding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const rows = provenance.filter((r) => r.entityType === entityType && r.entityId === entityId);

  useEffect(() => {
    if (!project || rows.length === 0) return;
    void listEvidence(project.id).then(setEvidence);
  }, [project, rows.length]);

  if (rows.length === 0) return null;

  const evidenceLabel = (row: FieldProvenance): string => {
    if (row.sourceType === 'manual') return 'manual entry';
    const record = evidence.find((e) => e.id === row.evidenceId);
    return record ? `${record.filename} (${record.sha256.slice(0, 8)}…)` : (row.evidenceId ?? '—');
  };

  const byField = new Map<string, FieldProvenance[]>();
  for (const row of rows) {
    const list = byField.get(row.field) ?? [];
    list.push(row);
    byField.set(row.field, list);
  }

  async function submitOverride(field: string) {
    if (!project) return;
    const result = await overrideField(project.id, { entityType, entityId, field, value: draft });
    setOverriding(null);
    setDraft('');
    useAppStore.setState({ availability: result.availability });
    await Promise.all([reload(), refreshProvenance()]);
  }

  return (
    <details className="provenance-section" data-testid="provenance-section" open>
      <summary>Provenance ({rows.length} rows)</summary>
      {[...byField.entries()].map(([field, fieldRows]) => (
        <div key={field} className="provenance-field" data-testid={`provenance-field-${field}`}>
          <div className="provenance-field__name">
            {field}
            <button
              type="button"
              className="provenance-field__override"
              data-testid={`override-${field}`}
              title="Manually override this imported value (undoable)"
              onClick={() => {
                setOverriding(overriding === field ? null : field);
                setDraft('');
              }}
            >
              Override
            </button>
          </div>
          {overriding === field && (
            <div className="provenance-field__editor">
              <input
                data-testid="override-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="new value"
              />
              <button
                type="button"
                data-testid="override-submit"
                onClick={() => void submitOverride(field)}
              >
                Apply
              </button>
            </div>
          )}
          <table className="provenance-table">
            <tbody>
              {fieldRows.map((row) => (
                <tr key={row.id} data-testid={`provenance-row-${row.status}`}>
                  <td title={JSON.stringify(row.observedValue)}>
                    {JSON.stringify(row.observedValue)}
                  </td>
                  <td>{row.sourceType}</td>
                  <td data-testid="provenance-evidence">{evidenceLabel(row)}</td>
                  <td>{Math.round(row.confidence * 100)}%</td>
                  <td>
                    <span className={`provenance-status provenance-status--${row.status}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </details>
  );
}
