import { useAppStore } from '../state/store';
import { deleteDevicesChangeSet, duplicateDevicesChangeSet } from '../state/ops';
import { DeviceInspector } from './DeviceInspector';
import { NetworkInspector, SiteInspector, ZoneInspector } from './StructureInspectors';
import { IdentityInspector } from './UsersRolesPanel';

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

  const id = selection.ids[0];
  let content = <p className="panel-empty">Select an object to inspect it.</p>;

  if (selection.entityType === 'device') {
    const device = graph.devices.find((d) => d.id === id);
    if (device) content = <DeviceInspector device={device} graph={graph} />;
  } else if (selection.entityType === 'network') {
    const network = graph.networks.find((n) => n.id === id);
    if (network) content = <NetworkInspector network={network} graph={graph} />;
  } else if (selection.entityType === 'site') {
    const site = graph.sites.find((s) => s.id === id);
    if (site) content = <SiteInspector site={site} graph={graph} />;
  } else if (selection.entityType === 'zone') {
    const zone = graph.zones.find((z) => z.id === id);
    if (zone) content = <ZoneInspector zone={zone} graph={graph} />;
  } else if (selection.entityType === 'identity' && id) {
    content = <IdentityInspector identityId={id} />;
  }

  return (
    <aside className="inspector-panel" data-testid="inspector-panel">
      <h2 className="panel-title">Inspector</h2>
      {content}
    </aside>
  );
}
