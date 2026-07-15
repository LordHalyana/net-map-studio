import { useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { downloadCsv, downloadNetplanBundle, requestImageExport } from '../export/exports';
import { autoArrangeChangeSet } from '../canvas/autoArrange';
import { GlobalSearch } from './GlobalSearch';

export function CommandBar() {
  const project = useAppStore((s) => s.project);
  const availability = useAppStore((s) => s.availability);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const syncError = useAppStore((s) => s.syncError);
  const pendingOps = useAppStore((s) => s.pendingOps);
  const layers = useAppStore((s) => s.layers);
  const toggleLogicalLayer = useAppStore((s) => s.toggleLogicalLayer);
  const connectMode = useAppStore((s) => s.connectMode);
  const toggleConnectMode = useAppStore((s) => s.toggleConnectMode);
  const togglePhysicalLayer = useAppStore((s) => s.togglePhysicalLayer);
  const graph = useAppStore((s) => s.graph);
  const dispatch = useAppStore((s) => s.dispatch);

  function arrange() {
    if (!graph) return;
    const cs = autoArrangeChangeSet(graph);
    if (cs) dispatch(cs);
  }

  return (
    <header className="command-bar" data-testid="command-bar">
      <span className="command-bar__brand">NetPlan Studio</span>
      <span className="command-bar__project" data-testid="project-name">
        {project?.name ?? 'Loading…'}
      </span>
      <div className="command-bar__actions">
        <button
          type="button"
          data-testid="undo-button"
          disabled={!availability.canUndo}
          onClick={() => void undo()}
          title="Undo"
        >
          ⤺ Undo
        </button>
        <button
          type="button"
          data-testid="redo-button"
          disabled={!availability.canRedo}
          onClick={() => void redo()}
          title="Redo"
        >
          ⤻ Redo
        </button>
        <button
          type="button"
          data-testid="toggle-connect-mode"
          className={connectMode ? 'toggle--on' : ''}
          onClick={toggleConnectMode}
          title="Connect mode: pick a source interface, then a destination (§3.3)"
        >
          ↯ Connect {connectMode ? 'on' : 'off'}
        </button>
        <button
          type="button"
          data-testid="toggle-logical-layer"
          className={layers.logical ? 'toggle--on' : ''}
          onClick={toggleLogicalLayer}
          title="Show or hide networks, membership edges and tints"
        >
          ◫ Logical {layers.logical ? 'on' : 'off'}
        </button>
        <button
          type="button"
          data-testid="toggle-physical-layer"
          className={layers.physical ? 'toggle--on' : ''}
          onClick={togglePhysicalLayer}
          title="Show or hide Link edges (physical topology)"
        >
          ─ Physical {layers.physical ? 'on' : 'off'}
        </button>
        <button
          type="button"
          data-testid="auto-arrange"
          onClick={arrange}
          title="Auto-arrange unpinned devices (pinned nodes stay put, §3.2C)"
        >
          ⌗ Arrange
        </button>
        <span className="command-bar__zoom" title="Zoom presets">
          {[0.5, 1, 2].map((level) => (
            <button
              key={level}
              type="button"
              data-testid={`zoom-${level * 100}`}
              onClick={() =>
                window.dispatchEvent(new CustomEvent('netplan:zoom', { detail: { level } }))
              }
            >
              {level * 100}%
            </button>
          ))}
        </span>
      </div>
      <GlobalSearch />
      <ExportMenu />
      <div className="command-bar__status" data-testid="sync-status">
        {syncError ? `⚠ ${syncError}` : pendingOps > 0 ? 'Saving…' : 'Saved'}
      </div>
    </header>
  );
}

function ExportMenu() {
  const project = useAppStore((s) => s.project);
  const importBundle = useAppStore((s) => s.importBundle);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!project) return null;

  const run = (action: () => Promise<void> | void) => () => {
    setOpen(false);
    setNotice(null);
    void Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : 'Export failed');
      });
  };

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    setNotice(null);
    try {
      await importBundle(await file.text());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Import failed');
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
      {notice && (
        <span className="export-menu__notice" data-testid="export-notice">
          ⚠ {notice}
        </span>
      )}
    </div>
  );
}
