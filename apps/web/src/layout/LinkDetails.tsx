import { linkKindSchema, type Link, type ProjectState } from '@netplan/domain';
import { useAppStore } from '../state/store';
import { opDeleteLink, opSetField } from '../state/ops';
import { networkColor } from '../canvas/networkColor';
import { nodeAccentColor } from '../canvas/roleColors';
import { SelectField, TextField } from './fields';

function endpointInfo(graph: ProjectState, link: Link, which: 'source' | 'target') {
  const endpoint = which === 'source' ? link.source : link.target;
  const iface = graph.interfaces.find((i) => i.id === endpoint.id);
  const device = iface ? graph.devices.find((d) => d.id === iface.deviceId) : undefined;
  const ip = iface
    ? graph.addresses.find((a) => a.interfaceId === iface.id && a.kind === 'ipv4')?.value
    : undefined;
  const memberships = device
    ? graph.interfaces
        .filter((i) => i.deviceId === device.id && i.networkId)
        .map((i) => ({
          networkId: i.networkId ?? '',
          name: '',
          color: networkColor(graph, i.networkId ?? ''),
          interfaceName: i.name,
        }))
    : [];
  return {
    deviceName: device?.name ?? '?',
    interfaceName: iface?.name ?? '?',
    ip,
    color: device ? nodeAccentColor(device, memberships) : 'var(--text-dim)',
  };
}

function EndpointCard({
  graph,
  link,
  which,
}: {
  graph: ProjectState;
  link: Link;
  which: 'source' | 'target';
}) {
  const info = endpointInfo(graph, link, which);
  return (
    <div className="endpoint-card">
      <span className="endpoint-card__role">{which === 'source' ? 'Source' : 'Destination'}</span>
      <span className="endpoint-card__title">
        <span className="endpoint-card__dot" style={{ background: info.color }} />
        {info.deviceName} ({info.interfaceName})
      </span>
      <span className="endpoint-card__ip">{info.ip ?? '—'}</span>
    </div>
  );
}

/**
 * LINK INFO view of the context panel (§3.3; concept layout since M7, gap
 * G9): kind/label form fields beside Source ⟷ Destination endpoint cards.
 * A bundle expands into its records.
 */
export function LinkDetails({ linkIds, graph }: { linkIds: string[]; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const links = graph.links.filter((l) => linkIds.includes(l.id));
  if (links.length === 0) return null;
  const projectId = graph.project.id;

  return (
    <div data-testid="link-details">
      {links.length > 1 && (
        <p data-testid="link-bundle-summary">
          Bundled edge — {links.length} links between this device pair:
        </p>
      )}
      <ul className="link-list">
        {links.map((link) => (
          <li key={link.id} className="link-list__item" data-testid={`link-item-${link.id}`}>
            <div className="link-list__form">
              <SelectField
                label="Kind"
                value={link.kind}
                options={linkKindSchema.options.map((value) => ({ value, label: value }))}
                onCommit={(v) =>
                  dispatch(opSetField(projectId, 'link', link.id, 'kind', v, link.kind))
                }
              />
              <TextField
                label="Label"
                value={link.label}
                onCommit={(v) =>
                  dispatch(opSetField(projectId, 'link', link.id, 'label', v, link.label))
                }
              />
            </div>
            <div className="link-list__endpoints">
              <EndpointCard graph={graph} link={link} which="source" />
              <span className="link-list__arrows" aria-hidden>
                ⟷
              </span>
              <EndpointCard graph={graph} link={link} which="target" />
            </div>
            <button
              type="button"
              title="Delete link"
              data-testid={`link-delete-${link.id}`}
              onClick={() => dispatch(opDeleteLink(projectId, link))}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
