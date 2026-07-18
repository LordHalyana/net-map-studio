import {
  Activity,
  Cable,
  Grid3x3,
  Link2,
  Magnet,
  Maximize,
  Redo2,
  Scan,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  Users,
  Waypoints,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAppStore } from '../state/store';
import { autoArrangeChangeSet } from '../canvas/autoArrange';
import { IconButton } from '../ui';

/**
 * Canvas toolbar (visual-parity M5, gap G6): the concept's second strip —
 * icon buttons with tooltips instead of text toggles, a segmented
 * AS-IS/TO-BE/Diff control, arrange and zoom presets. Mounted at the top of
 * the canvas region; the project bar above stays uncluttered.
 */
export function CanvasToolbar() {
  const availability = useAppStore((s) => s.availability);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const layers = useAppStore((s) => s.layers);
  const connectMode = useAppStore((s) => s.connectMode);
  const toggleConnectMode = useAppStore((s) => s.toggleConnectMode);
  const toggleLogicalLayer = useAppStore((s) => s.toggleLogicalLayer);
  const togglePhysicalLayer = useAppStore((s) => s.togglePhysicalLayer);
  const toggleObservedLayer = useAppStore((s) => s.toggleObservedLayer);
  const toggleIdentityOverlay = useAppStore((s) => s.toggleIdentityOverlay);
  const toggleRulesLayer = useAppStore((s) => s.toggleRulesLayer);
  const toggleFindingsLayer = useAppStore((s) => s.toggleFindingsLayer);
  const canvasMode = useAppStore((s) => s.canvasMode);
  const setCanvasMode = useAppStore((s) => s.setCanvasMode);
  const gridEnabled = useAppStore((s) => s.gridEnabled);
  const toggleGrid = useAppStore((s) => s.toggleGrid);
  const graph = useAppStore((s) => s.graph);
  const dispatch = useAppStore((s) => s.dispatch);

  const zoom = (level: number) =>
    window.dispatchEvent(new CustomEvent('netplan:zoom', { detail: { level } }));

  const toggles = [
    {
      testid: 'toggle-logical-layer',
      label: 'Logical layer',
      on: layers.logical,
      onClick: toggleLogicalLayer,
      title: 'Logical layer: networks, membership edges and tints',
      icon: Waypoints,
    },
    {
      testid: 'toggle-physical-layer',
      label: 'Physical layer',
      on: layers.physical,
      onClick: togglePhysicalLayer,
      title: 'Physical layer: Link edges',
      icon: Cable,
    },
    {
      testid: 'toggle-observed-layer',
      label: 'Observed traffic',
      on: layers.observed,
      onClick: toggleObservedLayer,
      title: 'Observed traffic: aggregated Flow bundles',
      icon: Activity,
    },
    {
      testid: 'toggle-identity-overlay',
      label: 'Identity overlay',
      on: layers.identities,
      onClick: toggleIdentityOverlay,
      title: 'Identity overlay (§3.9): modelled principals on their hosts',
      icon: Users,
    },
    {
      testid: 'toggle-rules-layer',
      label: 'Planned-rule callouts',
      on: layers.rules,
      onClick: toggleRulesLayer,
      title: 'Planned-rule callout cards (design §3.2C)',
      icon: ShieldCheck,
    },
    {
      testid: 'toggle-findings-layer',
      label: 'Findings layer',
      on: layers.findings,
      onClick: toggleFindingsLayer,
      title: 'Findings layer: severity tint on affected devices (§3.2C)',
      icon: TriangleAlert,
    },
  ] as const;

  return (
    <div className="canvas-toolbar" data-testid="canvas-toolbar">
      <IconButton
        icon={Undo2}
        iconSize={15}
        bare
        className="canvas-toolbar__btn"
        data-testid="undo-button"
        disabled={!availability.canUndo}
        onClick={() => void undo()}
        label="Undo"
      />
      <IconButton
        icon={Redo2}
        iconSize={15}
        bare
        className="canvas-toolbar__btn"
        data-testid="redo-button"
        disabled={!availability.canRedo}
        onClick={() => void redo()}
        label="Redo"
      />
      <span className="canvas-toolbar__sep" />
      <IconButton
        icon={Link2}
        iconSize={15}
        bare
        className={`canvas-toolbar__btn${connectMode ? ' canvas-toolbar__btn--on' : ''}`}
        data-testid="toggle-connect-mode"
        pressed={connectMode}
        onClick={toggleConnectMode}
        label="Connect mode"
        title="Connect mode: pick a source interface, then a destination (§3.3)"
      />
      <span className="canvas-toolbar__sep" />
      {toggles.map(({ testid, label, on, onClick, title, icon }) => (
        <IconButton
          key={testid}
          icon={icon}
          iconSize={15}
          bare
          className={`canvas-toolbar__btn${on ? ' canvas-toolbar__btn--on' : ''}`}
          data-testid={testid}
          pressed={on}
          onClick={onClick}
          label={label}
          title={title}
        />
      ))}
      <span className="canvas-toolbar__sep" />
      <span
        className="canvas-toolbar__modes"
        title="AS-IS / TO-BE / Diff (ADR-0009)"
        role="group"
        aria-label="Canvas mode"
      >
        {(
          [
            ['asIs', 'AS-IS'],
            ['toBe', 'TO-BE'],
            ['diff', 'Diff'],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            data-testid={`mode-${mode}`}
            className={canvasMode === mode ? 'canvas-toolbar__mode--on' : ''}
            aria-pressed={canvasMode === mode}
            onClick={() => setCanvasMode(mode)}
          >
            {label}
          </button>
        ))}
      </span>
      <span className="canvas-toolbar__sep" />
      <IconButton
        icon={Grid3x3}
        iconSize={15}
        bare
        className="canvas-toolbar__btn"
        data-testid="auto-arrange"
        onClick={() => {
          if (!graph) return;
          const cs = autoArrangeChangeSet(graph);
          if (cs) dispatch(cs);
        }}
        label="Auto-arrange"
        title="Auto-arrange unpinned devices (pinned nodes stay put, §3.2C)"
      />
      <IconButton
        icon={Magnet}
        iconSize={15}
        bare
        className={`canvas-toolbar__btn${gridEnabled ? ' canvas-toolbar__btn--on' : ''}`}
        data-testid="toggle-grid"
        pressed={gridEnabled}
        onClick={toggleGrid}
        label="Grid & snap-to-grid"
        title="Grid & snap-to-grid (§3.2A)"
      />
      <span className="canvas-toolbar__sep" />
      <span className="canvas-toolbar__zoom">
        <IconButton
          icon={Scan}
          iconSize={15}
          bare
          className="canvas-toolbar__btn"
          data-testid="fit-view"
          onClick={() => window.dispatchEvent(new CustomEvent('netplan:fit'))}
          label="Fit to screen"
        />
        <IconButton
          icon={ZoomOut}
          iconSize={15}
          bare
          className="canvas-toolbar__btn"
          data-testid="zoom-50"
          onClick={() => zoom(0.5)}
          label="Zoom to 50%"
        />
        <button
          type="button"
          className="canvas-toolbar__btn canvas-toolbar__btn--text"
          data-testid="zoom-100"
          onClick={() => zoom(1)}
          title="Zoom to 100%"
        >
          100%
        </button>
        <IconButton
          icon={ZoomIn}
          iconSize={15}
          bare
          className="canvas-toolbar__btn"
          data-testid="zoom-200"
          onClick={() => zoom(2)}
          label="Zoom to 200%"
        />
      </span>
      <IconButton
        icon={Maximize}
        iconSize={15}
        bare
        className="canvas-toolbar__btn"
        data-testid="toggle-fullscreen"
        onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen();
        }}
        label="Toggle fullscreen"
      />
    </div>
  );
}
