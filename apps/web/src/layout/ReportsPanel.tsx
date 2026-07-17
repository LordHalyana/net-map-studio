import { useState } from 'react';
import { newId, operationIdSchema, projectIdSchema, reportIdSchema } from '@netplan/domain';
import { downloadCsv, downloadNetplanBundle, requestImageExport } from '../export/exports';
import { useAppStore } from '../state/store';
import { Button, Spinner } from '../ui';

const CSV_ENTITIES = [
  'devices',
  'interfaces',
  'addresses',
  'networks',
  'services',
  'links',
  'policyRules',
  'identities',
  'flows',
  'findings',
] as const;

/**
 * REPORTS destination (design §3.2B/§3.4; improvements M11, #68): every
 * deliverable from one place, with redaction profile selection, above the
 * audit trail of past Report records.
 */
export function ReportsPanel() {
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const reload = useAppStore((s) => s.reload);
  const dispatch = useAppStore((s) => s.dispatch);
  const pushToast = useAppStore((s) => s.pushToast);
  const [profile, setProfile] = useState('');
  // the bundle is the one generator that runs long enough to need feedback (#90 B2)
  const [bundleBusy, setBundleBusy] = useState(false);
  if (!project || !graph) return null;

  /** Server-generated outputs write their own Report record — refresh the mirror. */
  const refreshSoon = () => setTimeout(() => void reload(), 1200);

  const openReport = (path: string) => {
    const redact = profile ? `?redact=${encodeURIComponent(profile)}` : '';
    window.open(`/api/projects/${project.id}${path}${redact}`, '_blank');
    refreshSoon();
  };

  /** Topology images render client-side — the record is dispatched from here. */
  function exportImage(format: 'png' | 'svg') {
    if (!project) return;
    requestImageExport(format);
    dispatch({
      id: newId(operationIdSchema),
      projectId: projectIdSchema.parse(project.id),
      kind: 'CreateEntity',
      payload: {
        entityType: 'report',
        entity: {
          id: newId(reportIdSchema),
          projectId: projectIdSchema.parse(project.id),
          type: 'topologyImage',
          createdAt: new Date().toISOString(),
          redactionProfile: '',
          parameters: { format },
          outputSha256: '',
        },
      },
    });
    pushToast(
      'Topology image rendered from the canvas — switch to the Canvas view if it looks empty.',
      'info',
    );
  }

  const reports = [...graph.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <section className="reports-panel" data-testid="reports-panel">
      <h2 className="panel-title">Reports</h2>

      <div className="reports-panel__generate">
        <label className="reports-panel__profile">
          Redaction profile
          <select
            value={profile}
            data-testid="reports-redaction-profile"
            onChange={(e) => setProfile(e.target.value)}
          >
            <option value="">none (full detail)</option>
            <option value="client-safe">client-safe</option>
          </select>
        </label>
        <div className="reports-panel__buttons">
          <Button
            data-testid="reports-generate-bundle"
            disabled={bundleBusy}
            onClick={() => {
              setBundleBusy(true);
              void downloadNetplanBundle(project.id, project.name)
                .then(refreshSoon)
                .catch((error: unknown) =>
                  pushToast(error instanceof Error ? error.message : 'Export failed'),
                )
                .finally(() => setBundleBusy(false));
            }}
          >
            {bundleBusy ? (
              <>
                <Spinner size="sm" label="Generating bundle" /> Generating…
              </>
            ) : (
              'Project bundle (.netplan)'
            )}
          </Button>
          <Button data-testid="reports-generate-design" onClick={() => openReport('/report')}>
            Design report (HTML)
          </Button>
          <Button
            data-testid="reports-generate-findings"
            onClick={() => openReport('/report/findings')}
          >
            Findings report (HTML)
          </Button>
          <Button
            data-testid="reports-generate-change"
            onClick={() => openReport('/report/change')}
          >
            Change report AS-IS → TO-BE (HTML)
          </Button>
          <Button data-testid="reports-generate-png" onClick={() => exportImage('png')}>
            Topology image (PNG)
          </Button>
          <Button data-testid="reports-generate-svg" onClick={() => exportImage('svg')}>
            Topology image (SVG)
          </Button>
        </div>
        <div className="reports-panel__buttons" data-testid="reports-csv-buttons">
          {CSV_ENTITIES.map((entity) => (
            <Button
              key={entity}
              size="sm"
              data-testid={`reports-csv-${entity}`}
              onClick={() => {
                void downloadCsv(project.id, entity)
                  .then(refreshSoon)
                  .catch((error: unknown) =>
                    pushToast(error instanceof Error ? error.message : 'CSV export failed'),
                  );
              }}
            >
              {entity}.csv
            </Button>
          ))}
        </div>
      </div>

      <h3 className="field-section__title">Generated reports ({reports.length})</h3>
      {reports.length === 0 ? (
        <p className="panel-empty">Generate a report above to see it here.</p>
      ) : (
        <table className="data-table reports-table" data-testid="reports-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Generated</th>
              <th>Redaction</th>
              <th>Parameters</th>
              <th>Output SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id} data-testid={`report-record-${report.id}`}>
                <td>{report.type}</td>
                <td>{new Date(report.createdAt).toLocaleString()}</td>
                <td>{report.redactionProfile || '—'}</td>
                <td>
                  {Object.entries(report.parameters)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(' ') || '—'}
                </td>
                <td className="reports-table__hash">
                  {report.outputSha256 ? report.outputSha256.slice(0, 12) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
