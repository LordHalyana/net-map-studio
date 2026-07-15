import { useAppStore } from '../state/store';

export function InspectorPanel() {
  const selection = useAppStore((s) => s.selection);
  const graph = useAppStore((s) => s.graph);

  const device =
    selection?.entityType === 'device'
      ? graph?.devices.find((d) => d.id === selection.id)
      : undefined;

  return (
    <aside className="inspector-panel" data-testid="inspector-panel">
      <h2 className="panel-title">Inspector</h2>
      {device ? (
        <dl className="inspector-fields" data-testid="inspector-device">
          <dt>Name</dt>
          <dd>{device.name}</dd>
          <dt>Type</dt>
          <dd>{device.deviceType}</dd>
          <dt>Lifecycle</dt>
          <dd>{device.lifecycleState}</dd>
        </dl>
      ) : (
        <p className="panel-empty">Select an object to inspect it.</p>
      )}
    </aside>
  );
}
