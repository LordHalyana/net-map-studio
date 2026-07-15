import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useAppStore } from '../state/store';
import type { NetworkNodeData, SiteNodeData, ZoneNodeData } from './graphToFlow';

/** Collapsible physical container (Containment, ADR-0013). */
export const SiteNode = memo(function SiteNode({ data }: NodeProps<Node<SiteNodeData, 'site'>>) {
  const toggle = useAppStore((s) => s.toggleSiteCollapsed);
  const { site, collapsed } = data;
  return (
    <div
      className={`site-node${collapsed ? ' site-node--collapsed' : ''}`}
      data-testid={`site-node-${site.name}`}
    >
      <div className="site-node__header">
        <button
          type="button"
          className="site-node__toggle"
          data-testid={`site-toggle-${site.name}`}
          onClick={(event) => {
            event.stopPropagation();
            toggle(site.id);
          }}
          title={collapsed ? 'Expand site' : 'Collapse site'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="site-node__name">🏢 {site.name}</span>
      </div>
    </div>
  );
});

export const ZoneNode = memo(function ZoneNode({ data }: NodeProps<Node<ZoneNodeData, 'zone'>>) {
  const { zone } = data;
  return (
    <div className="zone-node" data-testid={`zone-node-${zone.name}`}>
      <span className="zone-node__name">
        {zone.kind === 'rack' ? '🗄' : '▦'} {zone.name}
      </span>
    </div>
  );
});

/** A network-node is a projection of Membership, not a stored topological node (ADR-0013). */
export const NetworkNode = memo(function NetworkNode({
  data,
  selected,
}: NodeProps<Node<NetworkNodeData, 'network'>>) {
  const { network, color } = data;
  return (
    <div
      className={`network-node${selected ? ' network-node--selected' : ''}`}
      style={{ borderColor: color }}
      data-testid={`network-node-${network.name}`}
    >
      <Handle type="target" position={Position.Bottom} id="members" className="hidden-handle" />
      <span className="network-node__glyph" style={{ background: color }} />
      <div className="network-node__body">
        <span className="network-node__name">{network.name}</span>
        <span className="network-node__meta">
          {network.kind}
          {network.vlanId != null ? ` · VLAN ${network.vlanId}` : ''}
          {network.cidr ? ` · ${network.cidr}` : ''}
        </span>
      </div>
    </div>
  );
});
