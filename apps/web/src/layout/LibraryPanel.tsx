import { libraryCatalog } from '../library/catalog';
import { useAppStore } from '../state/store';
import {
  buildDevice,
  buildNetwork,
  buildSite,
  buildZone,
  opCreateDevice,
  opCreateEntity,
} from '../state/ops';
import type { DeviceType } from '@netplan/domain';

export const DND_MIME = 'application/x-netplan-device-type';

let dropOffset = 0;

export function LibraryPanel() {
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const dispatch = useAppStore((s) => s.dispatch);

  /** Click, double-click and keyboard (Enter/Space on the focused item) all land here. */
  function addDevice(deviceType: DeviceType) {
    if (!project || !graph) return;
    dropOffset = (dropOffset + 1) % 12;
    const existingNames = new Set(graph.devices.map((d) => d.name));
    const device = buildDevice(
      project.id,
      deviceType,
      { x: 120 + dropOffset * 40, y: 120 + dropOffset * 30 },
      existingNames,
    );
    dispatch(opCreateDevice(project.id, device));
  }

  function addNetwork() {
    if (!project || !graph) return;
    const network = buildNetwork(project.id, 'vlan', new Set(graph.networks.map((n) => n.name)), {
      x: 80 + graph.networks.length * 220,
      y: -140,
    });
    dispatch(opCreateEntity(project.id, { entityType: 'network', entity: network }));
  }

  function addSite() {
    if (!project || !graph) return;
    const site = buildSite(project.id, new Set(graph.sites.map((s) => s.name)), {
      x: 60 + graph.sites.length * 80,
      y: 320 + graph.sites.length * 60,
    });
    dispatch(opCreateEntity(project.id, { entityType: 'site', entity: site }));
  }

  function addZone() {
    if (!project || !graph) return;
    const site = graph.sites[0];
    if (!site) return;
    const zonesInSite = graph.zones.filter((z) => z.siteId === site.id);
    const zone = buildZone(site, new Set(graph.zones.map((z) => z.name)), {
      x: 20 + (zonesInSite.length % 2) * 220,
      y: 44 + Math.floor(zonesInSite.length / 2) * 165,
    });
    dispatch(opCreateEntity(project.id, { entityType: 'zone', entity: zone }));
  }

  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);

  return (
    <nav className="library-panel" data-testid="library-panel">
      <section className="library-category primary-nav" data-testid="primary-nav">
        <ul>
          {(
            [
              ['canvas', '🗺', 'Canvas'],
              ['imports', '⇪', 'Imports and Evidence'],
              ['identities', '👤', 'Users and Roles'],
              ['findings', '⚠', 'Findings'],
            ] as const
          ).map(([key, glyph, label]) => (
            <li key={key}>
              <button
                type="button"
                className={`library-item${view === key ? ' library-item--active' : ''}`}
                data-testid={`nav-${key}`}
                onClick={() => setView(key)}
              >
                <span className="library-item__glyph">{glyph}</span>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <h2 className="panel-title">Components</h2>
      <section className="library-category">
        <h3>Structure</h3>
        <ul>
          <li>
            <button
              type="button"
              className="library-item"
              data-testid="add-network"
              onClick={addNetwork}
            >
              <span className="library-item__glyph">☁</span>
              Network / VLAN
            </button>
          </li>
          <li>
            <button type="button" className="library-item" data-testid="add-site" onClick={addSite}>
              <span className="library-item__glyph">🏢</span>
              Site
            </button>
          </li>
          <li>
            <button
              type="button"
              className="library-item"
              data-testid="add-zone"
              onClick={addZone}
              disabled={!graph || graph.sites.length === 0}
              title={graph?.sites.length ? 'Add a zone to the first site' : 'Add a site first'}
            >
              <span className="library-item__glyph">▦</span>
              Zone
            </button>
          </li>
        </ul>
      </section>
      {libraryCatalog.map((category) => (
        <section key={category.key} className="library-category">
          <h3>{category.label}</h3>
          <ul>
            {category.items.map((item) => (
              <li key={item.deviceType}>
                <button
                  type="button"
                  className="library-item"
                  data-testid={`library-item-${item.deviceType}`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DND_MIME, item.deviceType);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => addDevice(item.deviceType)}
                >
                  <span className="library-item__glyph">{item.glyph}</span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
