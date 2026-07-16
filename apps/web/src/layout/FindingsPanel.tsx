import { useEffect, useState } from 'react';
import type { Severity } from '@netplan/domain';
import { useAppStore } from '../state/store';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const STATUS_ACTIONS = [
  ['acknowledged', 'Acknowledge'],
  ['underReview', 'Under review'],
  ['falsePositive', 'False positive'],
  ['acceptedRisk', 'Accept risk'],
  ['resolved', 'Resolved'],
] as const;

type StatusFilter = 'all' | 'open' | 'dispositioned';

function endpointLabel(
  affected: { kind: string; id: string } | null,
  graph: ReturnType<typeof useAppStore.getState>['graph'],
): string {
  if (!affected) return 'Network-wide';
  if (affected.kind === 'device') {
    const device = graph?.devices.find((d) => d.id === affected.id);
    return device ? device.name : `device ${affected.id.slice(0, 8)}`;
  }
  return `${affected.kind} ${affected.id.slice(0, 8)}`;
}

function toStatusFilter(value: string): StatusFilter {
  return value === 'open' || value === 'dispositioned' ? value : 'all';
}

/**
 * The Findings dashboard (design §2, §3.8, plan M11): findings grouped by
 * severity with evidence chain, rule/config version, verification steps and the
 * disposition workflow — each disposition an undoable Operation (M2). Detection
 * is a pure recompute, so "Re-run" simply refetches.
 */
export function FindingsPanel() {
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const report = useAppStore((s) => s.findings);
  const loading = useAppStore((s) => s.findingsLoading);
  const error = useAppStore((s) => s.findingsError);
  const refreshFindings = useAppStore((s) => s.refreshFindings);
  const disposeFinding = useAppStore((s) => s.disposeFinding);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const focusedFingerprint = useAppStore((s) => s.focusedFindingFingerprint);

  useEffect(() => {
    if (project && !report) void refreshFindings();
  }, [project, report, refreshFindings]);

  // a search hit lands here scrolled to its card (M3, #60)
  useEffect(() => {
    if (!focusedFingerprint || !report) return;
    document
      .querySelector(`[data-testid="finding-${focusedFingerprint}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusedFingerprint, report]);

  if (!project) return null;

  const findings = report?.findings ?? [];
  const categories = [
    ...new Set(findings.map((f) => f.detection?.category).filter((c): c is string => !!c)),
  ].sort();

  const visible = findings.filter((f) => {
    if (statusFilter === 'open' && f.status !== 'new') return false;
    if (statusFilter === 'dispositioned' && f.status === 'new') return false;
    if (categoryFilter !== 'all' && f.detection?.category !== categoryFilter) return false;
    return true;
  });

  const bySeverity = (severity: Severity) =>
    visible.filter((f) => (f.detection?.severity ?? 'info') === severity);

  return (
    <section className="findings-panel" data-testid="findings-panel">
      <div className="findings-header">
        <h2 className="panel-title">Security Findings</h2>
        <div className="findings-run" data-testid="findings-run-status">
          {report ? (
            <span className="findings-watermark">
              Computed as of op #{report.opSeq} · config {report.configHash.slice(0, 8)}
            </span>
          ) : (
            <span className="findings-watermark">Not yet computed</span>
          )}
          <button
            type="button"
            className="findings-rerun"
            data-testid="findings-rerun"
            onClick={() => void refreshFindings()}
            disabled={loading}
          >
            {loading ? 'Running…' : 'Re-run analysis'}
          </button>
        </div>
      </div>

      {error && <p className="panel-empty findings-error">⚠ {error}</p>}

      <div className="findings-filters" data-testid="findings-filters">
        <label>
          Status
          <select
            data-testid="findings-filter-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(toStatusFilter(e.target.value))}
          >
            <option value="all">All</option>
            <option value="open">Open (new)</option>
            <option value="dispositioned">Dispositioned</option>
          </select>
        </label>
        <label>
          Category
          <select
            data-testid="findings-filter-category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <span className="findings-count" data-testid="findings-count">
          {visible.length} of {findings.length} findings
        </span>
      </div>

      {report && findings.length === 0 && (
        <p className="panel-empty" data-testid="findings-empty">
          No findings. Import a device-state report to analyze this network.
        </p>
      )}

      <div className="findings-list">
        {SEVERITY_ORDER.map((severity) => {
          const group = bySeverity(severity);
          if (group.length === 0) return null;
          return (
            <div
              key={severity}
              className="findings-group"
              data-testid={`findings-group-${severity}`}
            >
              <h3 className={`findings-group__title severity--${severity}`}>
                {severity} <span className="findings-group__count">({group.length})</span>
              </h3>
              {group.map((f) => (
                <article
                  key={f.fingerprint}
                  className={`finding-card${f.stale ? ' finding-card--stale' : ''}${
                    f.fingerprint === focusedFingerprint ? ' finding-card--focused' : ''
                  }`}
                  data-testid={`finding-${f.fingerprint}`}
                >
                  <header className="finding-card__head">
                    <span className={`finding-badge severity--${f.detection?.severity ?? 'info'}`}>
                      {f.detection?.severity ?? '—'}
                    </span>
                    <span className="finding-title">{f.detection?.title ?? '(evidence gone)'}</span>
                    <span
                      className={`finding-status status--${f.status}`}
                      data-testid="finding-status"
                    >
                      {f.status}
                    </span>
                  </header>

                  {f.stale && (
                    <p className="finding-stale-note" data-testid="finding-stale">
                      Evidence for this finding is gone from the latest run — retained for your
                      disposition.
                    </p>
                  )}

                  {f.detection && (
                    <dl className="finding-detail">
                      <dt>Category</dt>
                      <dd>{f.detection.category}</dd>
                      <dt>Affected</dt>
                      <dd>{endpointLabel(f.detection.affected, graph)}</dd>
                      <dt>Confidence</dt>
                      <dd data-testid="finding-confidence">
                        {(f.detection.confidence * 100).toFixed(0)}%
                      </dd>
                      <dt>Rule</dt>
                      <dd data-testid="finding-rule">
                        {f.detection.ruleId} v{f.detection.ruleVersion}
                      </dd>
                      <dt>Evidence</dt>
                      <dd data-testid="finding-evidence">
                        {f.detection.evidenceRefs.length > 0
                          ? `${f.detection.evidenceRefs.length} evidence reference(s)`
                          : `${f.detection.contributingProvenanceRows.length} provenance row(s)`}
                      </dd>
                    </dl>
                  )}

                  {f.detection?.explanation && (
                    <p className="finding-explanation">{f.detection.explanation}</p>
                  )}

                  {f.detection && f.detection.verificationSteps.length > 0 && (
                    <details className="finding-verify">
                      <summary>Verification steps</summary>
                      <ol data-testid="finding-verification">
                        {f.detection.verificationSteps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </details>
                  )}

                  <div className="finding-actions" data-testid="finding-actions">
                    {STATUS_ACTIONS.map(([status, label]) => (
                      <button
                        key={status}
                        type="button"
                        className={`finding-action${f.status === status ? ' finding-action--active' : ''}`}
                        data-testid={`finding-set-${status}`}
                        disabled={f.status === status}
                        onClick={() => void disposeFinding(f.fingerprint, status, f.status)}
                      >
                        {label}
                      </button>
                    ))}
                    {f.status !== 'new' && (
                      <button
                        type="button"
                        className="finding-action"
                        data-testid="finding-reset"
                        onClick={() => void disposeFinding(f.fingerprint, 'new', f.status)}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          );
        })}
      </div>

      {report && report.coverage.length > 0 && (
        <div className="findings-coverage" data-testid="findings-coverage">
          <h3 className="panel-title">Collection coverage</h3>
          <table className="findings-coverage__table">
            <thead>
              <tr>
                <th>Device</th>
                <th>Evaluable input classes</th>
              </tr>
            </thead>
            <tbody>
              {report.coverage.map((c) => (
                <tr key={c.deviceId} data-testid={`coverage-${c.deviceName}`}>
                  <td>{c.deviceName}</td>
                  <td>
                    {c.available.length}/{c.available.length + c.missing.length}
                    {c.missing.length > 0 && (
                      <span className="findings-coverage__missing">
                        {' '}
                        · missing: {c.missing.join(', ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
