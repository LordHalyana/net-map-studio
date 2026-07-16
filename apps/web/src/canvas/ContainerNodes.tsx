import { memo } from 'react';
import { Handle, NodeResizeControl, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  HardDrive,
  LayoutGrid,
  Waypoints,
} from 'lucide-react';
import type { Size } from '@netplan/domain';
import { accentStyle } from './colors';
import { useAppStore } from '../state/store';
import { opSetField } from '../state/ops';
import { footprints } from './footprints';
import type { NetworkNodeData, SiteNodeData, ZoneNodeData } from './graphToFlow';

/**
 * Bottom-right resize handle (M1, #58). A single corner control keeps the
 * container origin fixed, so relative-positioned children never move — the
 * shrink clamp comes from the dynamic minimums, never from relocating.
 */
function ContainerResizer({
  minWidth,
  minHeight,
  current,
  onCommit,
  testId,
}: {
  minWidth: number;
  minHeight: number;
  current: Size;
  onCommit: (size: Size) => void;
  testId: string;
}) {
  return (
    <NodeResizeControl
      position="bottom-right"
      minWidth={minWidth}
      minHeight={minHeight}
      onResizeEnd={(_event, params) => {
        const size = { width: Math.round(params.width), height: Math.round(params.height) };
        if (size.width !== current.width || size.height !== current.height) onCommit(size);
      }}
      className="container-resize-handle"
    >
      <span className="container-resize-handle__grip" data-testid={testId} />
    </NodeResizeControl>
  );
}

/** Collapsible physical container (Containment, ADR-0013). */
export const SiteNode = memo(function SiteNode({
  data,
  selected,
}: NodeProps<Node<SiteNodeData, 'site'>>) {
  const toggle = useAppStore((s) => s.toggleSiteCollapsed);
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const collapsedZones = useAppStore((s) => s.collapsedZones);
  const dispatch = useAppStore((s) => s.dispatch);
  const { site, collapsed } = data;

  // shrink clamp (#78): the footprint resolver keeps every contained zone's
  // rendered rect inside — a Site can never shrink over a Zone
  const fp = graph ? footprints(graph, { collapsedZones }) : null;

  return (
    <div
      className={`site-node${collapsed ? ' site-node--collapsed' : ''}`}
      data-testid={`site-node-${site.name}`}
    >
      {selected && !collapsed && project && fp && (
        <ContainerResizer
          minWidth={fp.siteMinSize(site.id).width}
          minHeight={fp.siteMinSize(site.id).height}
          current={{ width: fp.siteRect(site).width, height: fp.siteRect(site).height }}
          onCommit={(size) =>
            dispatch(opSetField(project.id, 'site', site.id, 'size', size, site.size))
          }
          testId={`site-resize-${site.name}`}
        />
      )}
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

export const ZoneNode = memo(function ZoneNode({
  data,
  selected,
}: NodeProps<Node<ZoneNodeData, 'zone'>>) {
  const toggle = useAppStore((s) => s.toggleZoneCollapsed);
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const dispatch = useAppStore((s) => s.dispatch);
  const { zone, collapsed } = data;

  // shrink clamp (#78): the footprint resolver keeps every contained device's
  // full card inside — a Zone can never shrink over a Device
  const fp = graph ? footprints(graph) : null;

  return (
    <div
      className={`zone-node${collapsed ? ' zone-node--collapsed' : ''}`}
      data-testid={`zone-node-${zone.name}`}
    >
      {selected && !collapsed && project && fp && (
        <ContainerResizer
          minWidth={fp.zoneMinSize(zone.id).width}
          minHeight={fp.zoneMinSize(zone.id).height}
          current={fp.zoneSize(zone)}
          onCommit={(size) =>
            dispatch(opSetField(project.id, 'zone', zone.id, 'size', size, zone.size))
          }
          testId={`zone-resize-${zone.name}`}
        />
      )}
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
