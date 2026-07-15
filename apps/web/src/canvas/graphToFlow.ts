import type { Edge, Node } from '@xyflow/react';
import type {
  Device,
  Link,
  Network,
  Position as XY,
  ProjectState,
  Site,
  Zone,
} from '@netplan/domain';

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
  physical: boolean;
  collapsedSites: string[];
  collapsedZones: string[];
}

export const SITE_SIZE = { width: 460, height: 300 };
export const SITE_COLLAPSED_SIZE = { width: 200, height: 48 };
export const ZONE_SIZE = { width: 200, height: 150 };
export const ZONE_COLLAPSED_SIZE = { width: 170, height: 34 };

export type SiteNodeData = { site: Site; collapsed: boolean };
export type ZoneNodeData = { zone: Zone; collapsed: boolean };
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
  const collapsedZones = new Set(options.collapsedZones);
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
    const zoneCollapsed = collapsedZones.has(zone.id);
    nodes.push({
      id: zone.id,
      type: 'zone',
      parentId: zone.siteId,
      extent: 'parent',
      position: zone.position,
      data: { zone, collapsed: zoneCollapsed },
      style: zoneCollapsed ? { ...ZONE_COLLAPSED_SIZE } : { ...ZONE_SIZE },
      hidden: siteCollapsed,
      zIndex: -10,
    });
  }

  for (const device of state.devices) {
    const zone = device.zoneId ? zoneById.get(device.zoneId) : undefined;
    const hidden = zone ? collapsed.has(zone.siteId) || collapsedZones.has(zone.id) : false;
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

  // Links render between the owning Devices, bundled per device pair: multiple
  // records between the same pair collapse into one expandable edge (§3.3).
  const deviceByInterface = new Map(state.interfaces.map((i) => [i.id, i.deviceId]));
  const bundles = new Map<string, Link[]>();
  for (const link of options.physical ? state.links : []) {
    const sourceDevice = deviceByInterface.get(link.source.id);
    const targetDevice = deviceByInterface.get(link.target.id);
    if (!sourceDevice || !targetDevice) continue;
    if (hiddenDeviceIds.has(sourceDevice) || hiddenDeviceIds.has(targetDevice)) continue;
    const key = [sourceDevice, targetDevice].sort().join('~');
    const bundle = bundles.get(key) ?? [];
    bundle.push(link);
    bundles.set(key, bundle);
  }
  for (const [key, bundleLinks] of bundles) {
    const first = bundleLinks[0];
    if (!first) continue;
    const sourceDevice = deviceByInterface.get(first.source.id) ?? '';
    const targetDevice = deviceByInterface.get(first.target.id) ?? '';
    const single = bundleLinks.length === 1;
    edges.push({
      id: single ? `link-${first.id}` : `bundle-${key}`,
      source: sourceDevice,
      target: targetDevice,
      sourceHandle: 'link-out',
      targetHandle: 'link-in',
      type: 'default',
      data: { linkIds: bundleLinks.map((l) => l.id) },
      style: { stroke: '#8b94a7', strokeWidth: single ? 1.5 : 2.5 },
      label: single ? first.label || first.kind : `${bundleLinks.length} links`,
      labelStyle: { fill: '#d7dde8', fontSize: 10 },
      labelBgStyle: { fill: '#161a22' },
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
