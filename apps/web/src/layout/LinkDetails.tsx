import {
  linkKindSchema,
  type Endpoint,
  type Link,
  type PolicyRule,
  type ProjectState,
} from '@netplan/domain';
import { useAppStore } from '../state/store';
import { opDeleteLink, opSetField } from '../state/ops';
import { networkColorMap } from '../canvas/networkColor';
import { nodeAccentColor } from '../canvas/roleColors';
import { SelectField, TextField } from './fields';

function endpointInfo(graph: ProjectState, link: Link, which: 'source' | 'target') {
  const endpoint = which === 'source' ? link.source : link.target;
  const iface = graph.interfaces.find((i) => i.id === endpoint.id);
  const device = iface ? graph.devices.find((d) => d.id === iface.deviceId) : undefined;
  const ip = iface
    ? graph.addresses.find((a) => a.interfaceId === iface.id && a.kind === 'ipv4')?.value
    : undefined;
  const tints = networkColorMap(graph.networks);
  const memberships = device
    ? graph.interfaces
        .filter((i) => i.deviceId === device.id && i.networkId)
        .map((i) => ({ color: tints.get(i.networkId ?? '') ?? 'var(--text-dim)' }))
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
 * The PolicyRules governing the selected Links' endpoints (M3, #60; absorbs
 * the feature half of divergence #53). A projection, not schema — a rule
 * governs a Link when either rule endpoint resolves to one of the Link's
 * endpoint interfaces, their devices, those devices' networks or zones.
 */
function governingRules(graph: ProjectState, links: Link[]): PolicyRule[] {
  const ifaceIds = new Set(links.flatMap((l) => [l.source.id, l.target.id]));
  const deviceIds = new Set(
    graph.interfaces.filter((i) => ifaceIds.has(i.id)).map((i) => i.deviceId),
  );
  const networkIds = new Set(
    graph.interfaces
      .filter((i) => deviceIds.has(i.deviceId))
      .flatMap((i) => (i.networkId ? [i.networkId] : [])),
  );
  const zoneIds = new Set(
    graph.devices.filter((d) => deviceIds.has(d.id)).flatMap((d) => (d.zoneId ? [d.zoneId] : [])),
  );
  const matches = (endpoint: Endpoint) =>
    (endpoint.kind === 'interface' && ifaceIds.has(endpoint.id)) ||
    (endpoint.kind === 'device' && deviceIds.has(endpoint.id)) ||
    ((endpoint.kind === 'network' || endpoint.kind === 'subnet') && networkIds.has(endpoint.id)) ||
    (endpoint.kind === 'zone' && zoneIds.has(endpoint.id));
  return graph.policyRules.filter((rule) => matches(rule.source) || matches(rule.destination));
}

function GoverningRules({ graph, links }: { graph: ProjectState; links: Link[] }) {
  const focusRule = useAppStore((s) => s.focusRule);
  const rules = governingRules(graph, links);
  if (rules.length === 0) return null;
  return (
    <div className="governing-rules" data-testid="governing-rules">
      <h3 className="field-section__title">Governing policy rules</h3>
      <ul className="governing-rules__list">
        {rules.map((rule) => {
          const service = rule.serviceId
            ? graph.services.find((s) => s.id === rule.serviceId)
            : undefined;
          return (
            <li key={rule.id}>
              <button
                type="button"
                className="governing-rules__row"
                data-testid={`governing-rule-${rule.id}`}
                title="Open in the Rules tab"
                onClick={() => focusRule(rule.id)}
              >
                <span className={`rule-row__action rule-row__action--${rule.action}`}>
                  {rule.action}
                </span>
                <span>{service ? service.name : 'any service'}</span>
                <span className="rule-row__direction">{rule.direction}</span>
              </button>
            </li>
          );
        })}
      </ul>
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
      <GoverningRules graph={graph} links={links} />
    </div>
  );
}
