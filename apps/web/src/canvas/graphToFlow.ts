import type { Edge, Node } from '@xyflow/react';
import type { Device, Network, Position as XY, ProjectState, Site, Zone } from '@netplan/domain';

/** Stable tint per Network, used for membership edges and device chips. */
const palette = ['#4da3ff', '#4dc38a', '#e5b455', '#c78bff', '#e06c6c', '#5bd0d0', '#9fd05b'];

export function networkColor(state: ProjectState, networkId: string): string {
  const index = state.networks.findIndex((n) => n.id === networkId);
  return palette[(index + palette.length) % palette.length] ?? '#4da3ff';
}

export interface Membership {
  networkId: string;
  name: string;
  color: string;
  interfaceName: string;
}

export interface FlowOptions {
  logical: boolean;
  collapsedSites: string[];
}

export const SITE_SIZE = { width: 460, height: 300 };
export const SITE_COLLAPSED_SIZE = { width: 200, height: 48 };
export const ZONE_SIZE = { width: 200, height: 150 };

export type SiteNodeData = { site: Site; collapsed: boolean };
export type ZoneNodeData = { zone: Zone };
export type NetworkNodeData = { network: Network; color: string };
export type DeviceNodeData = { device: Device; memberships: Membership[]; showTint: boolean };

/**
 * Project the domain graph onto React Flow. Containment (Site › Zone › Device)
 * becomes parented sub-flow nodes; Membership becomes network-nodes plus
 * projected edges — never containment (ADR-0013).
 */
export function graphToFlow(
  state: ProjectState,
  options: FlowOptions,
): { nodes: Node[]; edges: Edge[] } {
  const collapsed = new Set(options.collapsedSites);
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const zoneById = new Map(state.zones.map((z) => [z.id, z]));
  const hiddenDeviceIds = new Set<string>();

  for (const site of state.sites) {
    const isCollapsed = collapsed.has(site.id);
    nodes.push({
      id: site.id,
      type: 'site',
      position: site.position,
      data: { site, collapsed: isCollapsed },
      style: isCollapsed ? { ...SITE_COLLAPSED_SIZE } : { ...SITE_SIZE },
      zIndex: -20,
    });
  }

  for (const zone of state.zones) {
    const siteCollapsed = collapsed.has(zone.siteId);
    nodes.push({
      id: zone.id,
      type: 'zone',
      parentId: zone.siteId,
      extent: 'parent',
      position: zone.position,
      data: { zone },
      style: { ...ZONE_SIZE },
      hidden: siteCollapsed,
      zIndex: -10,
    });
  }

  for (const device of state.devices) {
    const zone = device.zoneId ? zoneById.get(device.zoneId) : undefined;
    const hidden = zone ? collapsed.has(zone.siteId) : false;
    if (hidden) hiddenDeviceIds.add(device.id);
    const memberships: Membership[] = state.interfaces
      .filter((i) => i.deviceId === device.id && i.networkId)
      .map((i) => ({
        networkId: i.networkId ?? '',
        name: state.networks.find((n) => n.id === i.networkId)?.name ?? '?',
        color: networkColor(state, i.networkId ?? ''),
        interfaceName: i.name,
      }));
    nodes.push({
      id: device.id,
      type: 'device',
      parentId: zone?.id,
      extent: zone ? 'parent' : undefined,
      position: device.position,
      data: { device, memberships, showTint: options.logical },
      hidden,
    });
  }

  if (options.logical) {
    let fallbackX = 80;
    for (const network of state.networks) {
      const position: XY = network.layoutHints['main'] ?? { x: fallbackX, y: -140 };
      fallbackX += 220;
      nodes.push({
        id: network.id,
        type: 'network',
        position,
        data: { network, color: networkColor(state, network.id) },
      });
    }

    for (const iface of state.interfaces) {
      if (!iface.networkId) continue;
      if (hiddenDeviceIds.has(iface.deviceId)) continue;
      const color = networkColor(state, iface.networkId);
      edges.push({
        id: `membership-${iface.id}`,
        source: iface.deviceId,
        target: iface.networkId,
        sourceHandle: 'membership',
        targetHandle: 'members',
        type: 'default',
        style: { stroke: color, strokeDasharray: '6 3', opacity: 0.85 },
        label: iface.name,
        labelStyle: { fill: color, fontSize: 9 },
        labelBgStyle: { fill: '#161a22' },
      });
    }
  }

  return { nodes, edges };
}
