import { useRef, useState, type DragEvent } from 'react';
import {
  Building2,
  Cloud,
  DoorOpen,
  FileText,
  Gauge,
  ImagePlus,
  LayoutGrid,
  Map,
  Search,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Upload,
  Users,
  Waypoints,
} from 'lucide-react';
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
  function addDevice(deviceType: DeviceType, customIconKey?: string) {
    if (!project || !graph) return;
    dropOffset = (dropOffset + 1) % 12;
    const existingNames = new Set(graph.devices.map((d) => d.name));
    const device = buildDevice(
      project.id,
      deviceType,
      { x: 120 + dropOffset * 40, y: 120 + dropOffset * 30 },
      existingNames,
    );
    dispatch(opCreateDevice(project.id, customIconKey ? { ...device, customIconKey } : device));
  }

  /** Dropzone (G5): an image becomes a custom component carrying that icon. */
  function addCustomWithIcon(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') addDevice('custom', reader.result);
    };
    reader.readAsDataURL(file);
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
  const [filter, setFilter] = useState('');
  const iconInput = useRef<HTMLInputElement>(null);

  const matches = (label: string) =>
    filter.trim() === '' || label.toLowerCase().includes(filter.trim().toLowerCase());

  return (
    <nav className="library-panel" data-testid="library-panel">
      <div className="library-brand">
        <span className="library-brand__tile">
          <Waypoints size={18} aria-hidden />
        </span>
        <div className="library-brand__text">
          <span className="library-brand__name">NetPlan Studio</span>
          <span className="library-brand__tagline">Network planning, simplified.</span>
        </div>
      </div>
      <section className="library-category primary-nav" data-testid="primary-nav">
        <ul>
          {(
            [
              ['overview', Gauge, 'Overview'],
              ['canvas', Map, 'Canvas'],
              ['networks', Waypoints, 'Networks and VLANs'],
              ['rules', ShieldCheck, 'Rules'],
              ['imports', Upload, 'Imports and Evidence'],
              ['identities', Users, 'Users and Roles'],
              ['findings', TriangleAlert, 'Findings'],
              ['reports', FileText, 'Reports'],
              ['egress', DoorOpen, 'Egress and Threat Intel'],
              ['settings', Settings, 'Settings'],
            ] as const
          ).map(([key, Icon, label]) => (
            <li key={key}>
              <button
                type="button"
                className={`library-item${view === key ? ' library-item--active' : ''}`}
                data-testid={`nav-${key}`}
                aria-current={view === key ? 'page' : undefined}
                onClick={() => setView(key)}
              >
                <span className="library-item__glyph">
                  <Icon size={15} aria-hidden />
                </span>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <h2 className="panel-title">Library</h2>
      <label className="library-search">
        <Search size={13} aria-hidden />
        <input
          type="search"
          placeholder="Search components…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          data-testid="library-search"
        />
      </label>
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
              <span className="library-item__glyph">
                <Cloud size={15} aria-hidden />
              </span>
              Network / VLAN
            </button>
          </li>
          <li>
            <button type="button" className="library-item" data-testid="add-site" onClick={addSite}>
              <span className="library-item__glyph">
                <Building2 size={15} aria-hidden />
              </span>
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
              <span className="library-item__glyph">
                <LayoutGrid size={15} aria-hidden />
              </span>
              Zone
            </button>
          </li>
        </ul>
      </section>
      {libraryCatalog.map((category) => {
        const visible = category.items.filter((item) => matches(item.label));
        if (visible.length === 0) return null;
        return (
          <section key={category.key} className="library-category">
            <h3>{category.label}</h3>
            <div className="library-grid">
              {visible.map((item) => (
                <button
                  key={item.deviceType}
                  type="button"
                  className="library-tile"
                  data-testid={`library-item-${item.deviceType}`}
                  title={item.label}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DND_MIME, item.deviceType);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => addDevice(item.deviceType)}
                >
                  <item.icon size={17} aria-hidden />
                  <span className="library-tile__label">{item.label}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <button
        type="button"
        className="library-dropzone"
        data-testid="library-dropzone"
        onClick={() => iconInput.current?.click()}
        onDragOver={(event: DragEvent) => event.preventDefault()}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          addCustomWithIcon(event.dataTransfer.files[0]);
        }}
        title="Drop or pick an icon image to add a custom component carrying it"
      >
        <ImagePlus size={16} aria-hidden />
        Drag custom icon here or click to upload
      </button>
      <input
        ref={iconInput}
        type="file"
        accept="image/png,image/svg+xml,image/jpeg"
        style={{ display: 'none' }}
        data-testid="library-dropzone-input"
        onChange={(e) => {
          addCustomWithIcon(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </nav>
  );
}
