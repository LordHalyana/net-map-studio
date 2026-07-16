import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  HardDrive,
  LayoutGrid,
  Waypoints,
} from 'lucide-react';
import { accentStyle } from './colors';
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
          {collapsed ? (
            <ChevronRight size={12} aria-hidden />
          ) : (
            <ChevronDown size={12} aria-hidden />
          )}
        </button>
        <span className="site-node__name">
          <Building2 size={13} aria-hidden /> {site.name}
        </span>
      </div>
    </div>
  );
});

export const ZoneNode = memo(function ZoneNode({ data }: NodeProps<Node<ZoneNodeData, 'zone'>>) {
  const toggle = useAppStore((s) => s.toggleZoneCollapsed);
  const { zone, collapsed } = data;
  return (
    <div
      className={`zone-node${collapsed ? ' zone-node--collapsed' : ''}`}
      data-testid={`zone-node-${zone.name}`}
    >
      <span className="zone-node__name">
        <button
          type="button"
          className="site-node__toggle"
          data-testid={`zone-toggle-${zone.name}`}
          onClick={(event) => {
            event.stopPropagation();
            toggle(zone.id);
          }}
          title={collapsed ? 'Expand zone' : 'Collapse zone'}
        >
          {collapsed ? (
            <ChevronRight size={12} aria-hidden />
          ) : (
            <ChevronDown size={12} aria-hidden />
          )}
        </button>{' '}
        {zone.kind === 'rack' ? (
          <HardDrive size={12} aria-hidden />
        ) : (
          <LayoutGrid size={12} aria-hidden />
        )}{' '}
        {zone.name}
      </span>
    </div>
  );
});

/**
 * A network-node is a projection of Membership, not a stored topological node
 * (ADR-0013). Rendered as the concept's colored VLAN rectangle (M2, gap G2):
 * tinted icon tile, uppercase name, `VLAN nn · cidr` line, colored border+glow.
 */
export const NetworkNode = memo(function NetworkNode({
  data,
  selected,
}: NodeProps<Node<NetworkNodeData, 'network'>>) {
  const { network, color } = data;
  return (
    <div
      className={`network-node${selected ? ' network-node--selected' : ''}`}
      style={accentStyle(color)}
      data-testid={`network-node-${network.name}`}
    >
      <Handle type="target" position={Position.Bottom} id="members" className="hidden-handle" />
      <span className="network-node__tile">
        <Waypoints size={17} aria-hidden />
      </span>
      <div className="network-node__body">
        <span className="network-node__name">{network.name}</span>
        <span className="network-node__meta">
          {network.vlanId != null ? `VLAN ${network.vlanId}` : network.kind}
          {network.cidr ? ` · ${network.cidr}` : ''}
        </span>
      </div>
    </div>
  );
});
