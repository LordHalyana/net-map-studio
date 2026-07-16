import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { downloadCsv, downloadNetplanBundle, requestImageExport } from '../export/exports';
import { GlobalSearch } from './GlobalSearch';

/** "· just now" / "· N min ago" beside the save state (M6, #63). */
function savedAgo(lastSavedAt: number, now: number): string {
  const minutes = Math.floor((now - lastSavedAt) / 60_000);
  if (minutes < 1) return '· just now';
  if (minutes < 60) return `· ${minutes} min ago`;
  return `· ${Math.floor(minutes / 60)} h ago`;
}

/**
 * Project bar (visual-parity M5, gap G6): the concept's top strip — project
 * identity, save state, search and export. Canvas controls live in the
 * CanvasToolbar; the brand block lives in the library panel.
 */
export function CommandBar() {
  const project = useAppStore((s) => s.project);
  const syncError = useAppStore((s) => s.syncError);
  const pendingOps = useAppStore((s) => s.pendingOps);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);

  // tick so the relative timestamp stays honest
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="command-bar" data-testid="command-bar">
      <span className="command-bar__label">Project:</span>
      <span className="command-bar__project" data-testid="project-name">
        {project?.name ?? 'Loading…'}
      </span>
      <div
        className={`command-bar__status${!syncError && pendingOps === 0 ? ' command-bar__status--saved' : ''}`}
        data-testid="sync-status"
      >
        {syncError ? `⚠ ${syncError}` : pendingOps > 0 ? 'Saving…' : 'Saved'}
      </div>
      {!syncError && pendingOps === 0 && lastSavedAt !== null && (
        <span className="command-bar__saved-ago" data-testid="saved-ago">
          {savedAgo(lastSavedAt, now)}
        </span>
      )}
      <GlobalSearch />
      <ExportMenu />
      <div className="command-bar__avatar" title="Operator (single-operator, ADR-0001)">
        OP
      </div>
    </header>
  );
}

function ExportMenu() {
  const project = useAppStore((s) => s.project);
  const importBundle = useAppStore((s) => s.importBundle);
  const pushToast = useAppStore((s) => s.pushToast);
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!project) return null;

  const run = (action: () => Promise<void> | void) => () => {
    setOpen(false);
    void Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        pushToast(error instanceof Error ? error.message : 'Export failed');
      });
  };

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    try {
      await importBundle(await file.text());
      pushToast('Project bundle imported.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Import failed');
    }
  }

  return (
    <div className="export-menu">
      <button type="button" data-testid="export-menu-toggle" onClick={() => setOpen(!open)}>
        ⇩ Export / Import
      </button>
      {open && (
        <div className="export-menu__list" data-testid="export-menu">
          <button
            type="button"
            data-testid="export-netplan"
            onClick={run(() => downloadNetplanBundle(project.id, project.name))}
          >
            Project bundle (.netplan)
          </button>
          <button
            type="button"
            data-testid="export-png"
            onClick={run(() => requestImageExport('png'))}
          >
            Topology image (PNG)
          </button>
          <button
            type="button"
            data-testid="export-svg"
            onClick={run(() => requestImageExport('svg'))}
          >
            Topology image (SVG)
          </button>
          <button
            type="button"
            data-testid="export-csv-devices"
            onClick={run(() => downloadCsv(project.id, 'devices'))}
          >
            Devices (CSV)
          </button>
          <button
            type="button"
            data-testid="export-csv-rules"
            onClick={run(() => downloadCsv(project.id, 'policyRules'))}
          >
            Rules (CSV)
          </button>
          <button
            type="button"
            data-testid="export-report"
            onClick={run(() => {
              window.open(`/api/projects/${project.id}/report`, '_blank');
            })}
          >
            Design report (HTML)
          </button>
          <button
            type="button"
            data-testid="export-findings-report"
            onClick={run(() => {
              window.open(`/api/projects/${project.id}/report/findings`, '_blank');
            })}
          >
            Security findings report (HTML)
          </button>
          <button
            type="button"
            data-testid="export-findings-report-safe"
            onClick={run(() => {
              window.open(
                `/api/projects/${project.id}/report/findings?redact=client-safe`,
                '_blank',
              );
            })}
          >
            Security findings — client-safe (HTML)
          </button>
          <button
            type="button"
            data-testid="export-csv-findings"
            onClick={run(() => {
              window.open(`/api/projects/${project.id}/export/csv/findings`, '_blank');
            })}
          >
            Findings (CSV)
          </button>
          <button
            type="button"
            data-testid="import-netplan"
            onClick={() => {
              setOpen(false);
              fileInput.current?.click();
            }}
          >
            Import bundle…
          </button>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".netplan,application/json"
        className="export-menu__file"
        data-testid="import-file-input"
        onChange={(e) => {
          void onImportFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
