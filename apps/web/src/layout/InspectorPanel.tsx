import { useAppStore } from '../state/store';
import { deleteDevicesChangeSet, duplicateDevicesChangeSet } from '../state/ops';
import { DeviceInspector } from './DeviceInspector';

export function InspectorPanel() {
  const selection = useAppStore((s) => s.selection);
  const graph = useAppStore((s) => s.graph);
  const dispatch = useAppStore((s) => s.dispatch);

  if (!graph || !selection || selection.ids.length === 0) {
    return (
      <aside className="inspector-panel" data-testid="inspector-panel">
        <h2 className="panel-title">Inspector</h2>
        <p className="panel-empty">Select an object to inspect it.</p>
      </aside>
    );
  }

  if (selection.entityType === 'device' && selection.ids.length > 1) {
    return (
      <aside className="inspector-panel" data-testid="inspector-panel">
        <h2 className="panel-title">Inspector</h2>
        <p data-testid="inspector-multi">{selection.ids.length} devices selected</p>
        <div className="inspector-actions">
          <button
            type="button"
            data-testid="duplicate-selection"
            onClick={() => {
              const cs = duplicateDevicesChangeSet(graph, selection.ids);
              if (cs) dispatch(cs);
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            data-testid="delete-selection"
            onClick={() => {
              const cs = deleteDevicesChangeSet(graph, selection.ids);
              if (cs) dispatch(cs);
            }}
          >
            Delete
          </button>
        </div>
      </aside>
    );
  }

  const device =
    selection.entityType === 'device'
      ? graph.devices.find((d) => d.id === selection.ids[0])
      : undefined;

  return (
    <aside className="inspector-panel" data-testid="inspector-panel">
      <h2 className="panel-title">Inspector</h2>
      {device ? (
        <DeviceInspector device={device} graph={graph} />
      ) : (
        <p className="panel-empty">Select an object to inspect it.</p>
      )}
    </aside>
  );
}
