import {
  networkKindSchema,
  zoneKindSchema,
  type Network,
  type ProjectState,
  type Site,
  type Zone,
} from '@netplan/domain';
import { useAppStore } from '../state/store';
import { opSetField } from '../state/ops';
import { FieldSection, SelectField, TextField } from './fields';

export function NetworkInspector({ network, graph }: { network: Network; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const projectId = graph.project.id;
  const set = (field: string, value: unknown, previous: unknown) =>
    dispatch(opSetField(projectId, 'network', network.id, field, value, previous));

  const members = graph.interfaces.filter((i) => i.networkId === network.id);

  return (
    <div data-testid="inspector-network">
      <FieldSection title="Network">
        <TextField
          label="Name"
          value={network.name}
          testId="network-name-input"
          onCommit={(v) => v.trim() && set('name', v.trim(), network.name)}
        />
        <SelectField
          label="Kind"
          value={network.kind}
          options={networkKindSchema.options.map((value) => ({ value, label: value }))}
          onCommit={(v) => set('kind', v, network.kind)}
        />
        <TextField
          label="VLAN id"
          value={network.vlanId?.toString() ?? ''}
          testId="network-vlan-input"
          placeholder="1–4094"
          onCommit={(v) => {
            const trimmed = v.trim();
            if (!trimmed) return set('vlanId', null, network.vlanId);
            const parsed = Number.parseInt(trimmed, 10);
            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 4094) {
              set('vlanId', parsed, network.vlanId);
            }
          }}
        />
        <TextField
          label="CIDR"
          value={network.cidr}
          placeholder="10.0.10.0/24"
          onCommit={(v) => set('cidr', v.trim(), network.cidr)}
        />
      </FieldSection>
      <FieldSection title="Members">
        {members.length === 0 ? (
          <p className="panel-empty">No interfaces in this network.</p>
        ) : (
          <ul className="member-list" data-testid="network-members">
            {members.map((iface) => {
              const device = graph.devices.find((d) => d.id === iface.deviceId);
              return (
                <li key={iface.id}>
                  {device?.name ?? '?'} · {iface.name}
                </li>
              );
            })}
          </ul>
        )}
      </FieldSection>
    </div>
  );
}

export function SiteInspector({ site, graph }: { site: Site; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const set = (field: string, value: unknown, previous: unknown) =>
    dispatch(opSetField(graph.project.id, 'site', site.id, field, value, previous));
  return (
    <div data-testid="inspector-site">
      <FieldSection title="Site">
        <TextField
          label="Name"
          value={site.name}
          testId="site-name-input"
          onCommit={(v) => v.trim() && set('name', v.trim(), site.name)}
        />
        <TextField
          label="Description"
          value={site.description}
          onCommit={(v) => set('description', v, site.description)}
        />
      </FieldSection>
    </div>
  );
}

export function ZoneInspector({ zone, graph }: { zone: Zone; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const set = (field: string, value: unknown, previous: unknown) =>
    dispatch(opSetField(graph.project.id, 'zone', zone.id, field, value, previous));
  return (
    <div data-testid="inspector-zone">
      <FieldSection title="Zone">
        <TextField
          label="Name"
          value={zone.name}
          testId="zone-name-input"
          onCommit={(v) => v.trim() && set('name', v.trim(), zone.name)}
        />
        <SelectField
          label="Kind"
          value={zone.kind}
          options={zoneKindSchema.options.map((value) => ({ value, label: value }))}
          onCommit={(v) => set('kind', v, zone.kind)}
        />
      </FieldSection>
    </div>
  );
}
