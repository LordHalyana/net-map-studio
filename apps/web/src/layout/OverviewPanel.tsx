import { useEffect } from 'react';
import type { Severity } from '@netplan/domain';
import { useAppStore } from '../state/store';
import { useOperationLog } from '../state/useOperationLog';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * OVERVIEW destination (design §3.2B; improvements M10, #67): counts and
 * health at a glance. Read-only — everything here already reaches the client
 * through existing endpoints.
 */
export function OverviewPanel() {
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const findings = useAppStore((s) => s.findings);
  const refreshFindings = useAppStore((s) => s.refreshFindings);
  const importJobs = useAppStore((s) => s.importJobs);
  const refreshImports = useAppStore((s) => s.refreshImports);
  const setView = useAppStore((s) => s.setView);
  const { entries: logEntries, error: logError } = useOperationLog();
  const recent = logEntries.slice(-8).reverse();

  useEffect(() => {
    if (project && !findings) void refreshFindings();
  }, [project, findings, refreshFindings]);
  useEffect(() => {
    void refreshImports();
  }, [refreshImports]);

  if (!graph) return null;

  const byType = new Map<string, number>();
  const byLifecycle = new Map<string, number>();
  for (const device of graph.devices) {
    byType.set(device.deviceType, (byType.get(device.deviceType) ?? 0) + 1);
    byLifecycle.set(device.lifecycleState, (byLifecycle.get(device.lifecycleState) ?? 0) + 1);
  }
  const openBySeverity = new Map<Severity, number>();
  for (const finding of findings?.findings ?? []) {
    if (finding.status !== 'new' || finding.stale) continue;
    const severity = finding.detection?.severity ?? 'info';
    openBySeverity.set(severity, (openBySeverity.get(severity) ?? 0) + 1);
  }
  const lastImport = [...importJobs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

  return (
    <section className="overview-panel" data-testid="overview-panel">
      <h2 className="panel-title">Overview</h2>
      <div className="overview-tiles">
        <div className="overview-tile" data-testid="overview-devices">
          <span className="overview-tile__count">{graph.devices.length}</span>
          <span className="overview-tile__label">Devices</span>
        </div>
        <div className="overview-tile" data-testid="overview-networks">
          <span className="overview-tile__count">{graph.networks.length}</span>
          <span className="overview-tile__label">Networks</span>
        </div>
        <div className="overview-tile" data-testid="overview-links">
          <span className="overview-tile__count">{graph.links.length}</span>
          <span className="overview-tile__label">Links</span>
        </div>
        <div className="overview-tile" data-testid="overview-rules">
          <span className="overview-tile__count">{graph.policyRules.length}</span>
          <span className="overview-tile__label">Policy rules</span>
        </div>
        <button
          type="button"
          className="overview-tile overview-tile--action"
          data-testid="overview-findings"
          onClick={() => setView('findings')}
          title="Open the Findings view"
        >
          <span className="overview-tile__count">
            {[...openBySeverity.values()].reduce((sum, n) => sum + n, 0)}
          </span>
          <span className="overview-tile__label">Open findings</span>
        </button>
      </div>

      <div className="overview-columns">
        <div className="overview-column">
          <h3 className="field-section__title">Devices by type</h3>
          <ul className="overview-list" data-testid="overview-devices-by-type">
            {[...byType.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <li key={type}>
                  <span>{type}</span>
                  <span className="overview-list__count">{count}</span>
                </li>
              ))}
            {byType.size === 0 && (
              <li className="panel-empty">No devices yet — add one, or import evidence.</li>
            )}
          </ul>
          <h3 className="field-section__title">Lifecycle</h3>
          <ul className="overview-list">
            {[...byLifecycle.entries()].map(([state, count]) => (
              <li key={state}>
                <span>{state}</span>
                <span className="overview-list__count">{count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="overview-column">
          <h3 className="field-section__title">Open findings by severity</h3>
          <ul className="overview-list" data-testid="overview-findings-by-severity">
            {SEVERITY_ORDER.filter((s) => openBySeverity.has(s)).map((severity) => (
              <li key={severity}>
                <span className={`finding-badge severity--${severity}`}>{severity}</span>
                <span className="overview-list__count">{openBySeverity.get(severity)}</span>
              </li>
            ))}
            {openBySeverity.size === 0 && <li className="panel-empty">None open.</li>}
          </ul>
          <h3 className="field-section__title">Last import</h3>
          <p data-testid="overview-last-import">
            {lastImport
              ? `${lastImport.parserName} · ${lastImport.status} · ${new Date(lastImport.startedAt).toLocaleString()}`
              : 'No imports yet.'}
          </p>
        </div>

        <div className="overview-column">
          <h3 className="field-section__title">Recent activity</h3>
          <ul className="overview-list" data-testid="overview-activity">
            {recent.map((entry) => (
              <li key={entry.seq}>
                <span>{entry.kind}</span>
                <span className="overview-list__count">#{entry.seq}</span>
              </li>
            ))}
            {recent.length === 0 && (
              <li className="panel-empty">
                {logError
                  ? `Couldn’t load activity — ${logError}`
                  : 'No operations yet — your edits will appear here.'}
              </li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
