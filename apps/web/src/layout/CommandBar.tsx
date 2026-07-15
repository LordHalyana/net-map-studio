import { useAppStore } from '../state/store';

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
          ◫ Logical layer {layers.logical ? 'on' : 'off'}
        </button>
      </div>
      <div className="command-bar__status" data-testid="sync-status">
        {syncError ? `⚠ ${syncError}` : pendingOps > 0 ? 'Saving…' : 'Saved'}
      </div>
    </header>
  );
}
