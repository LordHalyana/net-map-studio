import { useState } from 'react';
import {
  networkKindSchema,
  zoneKindSchema,
  type Network,
  type ProjectState,
  type Site,
  type Zone,
} from '@netplan/domain';
import { useAppStore } from '../state/store';
import {
  deleteSiteChangeSet,
  deleteSiteImpact,
  deleteZoneChangeSet,
  deleteZoneImpact,
  opSetField,
} from '../state/ops';
import { VLAN_PALETTE } from '../canvas/networkColor';
import { Button, ConfirmDialog } from '../ui';
import { FieldSection, SelectField, TextField } from './fields';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Impact summary for the delete confirm — only non-zero lines render. */
function DeleteImpactBody({
  kind,
  name,
  lines,
}: {
  kind: 'site' | 'zone';
  name: string;
  lines: string[];
}) {
  return (
    <>
      <p>
        This deletes the {kind} <strong>{name}</strong>.
        {lines.length === 0 ? ' Nothing else is affected.' : ''}
      </p>
      {lines.length > 0 && (
        <ul>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <p>Undo (Ctrl+Z) restores everything.</p>
    </>
  );
}

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
        {/* persisted tint (M6, #63; divergence #50): swatches pin a hue,
            Auto returns to the hash-stable palette */}
        <div className="field" data-testid="network-color-picker">
          <span className="field__label">Color</span>
          <span className="color-swatches">
            {VLAN_PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`color-swatch${network.color === hex ? ' color-swatch--on' : ''}`}
                style={{ background: hex }}
                title={hex}
                data-testid={`network-color-${hex.slice(1)}`}
                onClick={() => set('color', hex, network.color)}
              />
            ))}
            <button
              type="button"
              className={`color-swatch color-swatch--auto${network.color === null ? ' color-swatch--on' : ''}`}
              title="Automatic (hash-stable palette)"
              data-testid="network-color-auto"
              onClick={() => set('color', null, network.color)}
            >
              A
            </button>
          </span>
        </div>
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
  const [confirming, setConfirming] = useState(false);
  const set = (field: string, value: unknown, previous: unknown) =>
    dispatch(opSetField(graph.project.id, 'site', site.id, field, value, previous));

  const impact = deleteSiteImpact(graph, site.id);
  const impactLines = [
    impact.zones.length > 0 && `${plural(impact.zones.length, 'zone')} will be deleted`,
    impact.devices.length > 0 &&
      `${plural(impact.devices.length, 'device')} will stay on the canvas, no longer in a zone`,
    impact.rules.length > 0 &&
      `${plural(impact.rules.length, 'zone-targeting rule')} will be removed`,
    impact.flows.length > 0 &&
      `${plural(impact.flows.length, 'zone-targeting flow')} will be removed`,
  ].filter((line): line is string => Boolean(line));

  return (
    <div data-testid="inspector-site">
      <div className="inspector-actions">
        <Button
          variant="danger"
          data-testid="inspector-delete-site"
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      </div>
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
      <ConfirmDialog
        open={confirming}
        title={`Delete site ${site.name}?`}
        body={<DeleteImpactBody kind="site" name={site.name} lines={impactLines} />}
        confirmLabel="Delete site"
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          const cs = deleteSiteChangeSet(graph, site.id);
          if (cs) dispatch(cs);
        }}
      />
    </div>
  );
}

export function ZoneInspector({ zone, graph }: { zone: Zone; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const [confirming, setConfirming] = useState(false);
  const set = (field: string, value: unknown, previous: unknown) =>
    dispatch(opSetField(graph.project.id, 'zone', zone.id, field, value, previous));

  const impact = deleteZoneImpact(graph, zone.id);
  const impactLines = [
    impact.devices.length > 0 &&
      `${plural(impact.devices.length, 'device')} will stay on the canvas, no longer in this zone`,
    impact.rules.length > 0 &&
      `${plural(impact.rules.length, 'zone-targeting rule')} will be removed`,
    impact.flows.length > 0 &&
      `${plural(impact.flows.length, 'zone-targeting flow')} will be removed`,
  ].filter((line): line is string => Boolean(line));

  return (
    <div data-testid="inspector-zone">
      <div className="inspector-actions">
        <Button
          variant="danger"
          data-testid="inspector-delete-zone"
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      </div>
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
      <ConfirmDialog
        open={confirming}
        title={`Delete zone ${zone.name}?`}
        body={<DeleteImpactBody kind="zone" name={zone.name} lines={impactLines} />}
        confirmLabel="Delete zone"
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          const cs = deleteZoneChangeSet(graph, zone.id);
          if (cs) dispatch(cs);
        }}
      />
    </div>
  );
}
