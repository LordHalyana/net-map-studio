import type { Edge, Node } from '@xyflow/react';
import { PORT_DOT_MARKER } from './EdgeMarkerDefs';
import type {
  Device,
  FieldProvenance,
  Flow,
  Link,
  Network,
  Position as XY,
  ProjectState,
  Site,
  Zone,
} from '@netplan/domain';

import { networkColor } from './networkColor';

export { networkColor };

export interface Membership {
  networkId: string;
  name: string;
  color: string;
  interfaceName: string;
}

export interface FlowOptions {
  logical: boolean;
  physical: boolean;
  /** Observed traffic layer: aggregated Flow bundles (Phase 2). */
  observed: boolean;
  /** Identity overlay (§3.9): principal chips on their hosts, off by default. */
  identities: boolean;
  /** AS-IS / TO-BE / Diff (ADR-0009). */
  mode: 'asIs' | 'toBe' | 'diff';
  /** Provenance sidecar mirror; feeds confidence/evidence badges (M8). */
  provenance: FieldProvenance[];
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
export type DeviceNodeData = {
  device: Device;
  memberships: Membership[];
  /** Primary address for the node's second line (concept shows IP, gap G1). */
  primaryIp: string | null;
  showTint: boolean;
  /** Highest accepted provenance confidence across fields (M8); null = manual object. */
  confidence: number | null;
  /** Distinct evidence files this device's fields trace to (M8). */
  evidenceCount: number;
  /** Identity overlay chips (M10); empty unless the overlay is on. */
  identityChips: { id: string; label: string; scope: 'local' | 'domain' }[];
  /** Diff-mode emphasis (ADR-0009). */
  diffState: 'added' | 'removed' | null;
};

/**
 * Project the domain graph onto React Flow. Containment (Site › Zone › Device)
 * becomes parented sub-flow nodes; Membership becomes network-nodes plus
 * projected edges — never containment (ADR-0013).
 */
/**
 * AS-IS hides planned-only objects; TO-BE ghosts removals-in-proposal; Diff
 * shows everything with add/remove emphasis (ADR-0009, design §3.10).
 */
function modeVisible(lifecycleState: string, mode: FlowOptions['mode']): boolean {
  if (mode === 'asIs') return lifecycleState !== 'planned';
  return true;
}

function diffStateOf(
  lifecycleState: string,
  mode: FlowOptions['mode'],
): 'added' | 'removed' | null {
  if (mode === 'asIs') return null;
  if (lifecycleState === 'planned') return mode === 'diff' ? 'added' : null;
  if (lifecycleState === 'removedInProposal') return 'removed';
  return null;
}

export function graphToFlow(
  state: ProjectState,
  options: FlowOptions,
): { nodes: Node[]; edges: Edge[] } {
  const collapsed = new Set(options.collapsedSites);
  const collapsedZones = new Set(options.collapsedZones);
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  // Orthogonal routing with port dots (M3 prototype verdict, issue #45):
  // smoothstep reads like the concept's right-angle lines at canvas zoom and
  // stays soft on dense fans. React Flow wraps the marker id in url(#...).
  const edgeType = 'smoothstep';
  const portDots = { markerStart: PORT_DOT_MARKER, markerEnd: PORT_DOT_MARKER };

  const zoneById = new Map(state.zones.map((z) => [z.id, z]));
  const hiddenDeviceIds = new Set<string>();

  // primary IP per device: first ipv4 (falling back to ipv6) across its interfaces
  const primaryIpByDevice = new Map<string, string>();
  {
    const interfaceOwner = new Map(state.interfaces.map((i) => [i.id, i.deviceId]));
    for (const kind of ['ipv4', 'ipv6'] as const) {
      for (const address of state.addresses) {
        if (address.kind !== kind) continue;
        const deviceId = interfaceOwner.get(address.interfaceId);
        if (deviceId && !primaryIpByDevice.has(deviceId)) {
          primaryIpByDevice.set(deviceId, address.value);
        }
      }
    }
  }

  // provenance badges (M8): winning confidence + distinct evidence per device
  const deviceConfidence = new Map<string, number>();
  const deviceEvidence = new Map<string, Set<string>>();
  for (const row of options.provenance) {
    if (row.entityType !== 'device' || row.status !== 'accepted') continue;
    const current = deviceConfidence.get(row.entityId) ?? 0;
    if (row.confidence > current) deviceConfidence.set(row.entityId, row.confidence);
    if (row.evidenceId) {
      const set = deviceEvidence.get(row.entityId) ?? new Set<string>();
      set.add(row.evidenceId);
      deviceEvidence.set(row.entityId, set);
    }
  }

  // identity overlay chips (M10): hidden from the canvas until enabled
  const identityChipsByDevice = new Map<string, DeviceNodeData['identityChips']>();
  if (options.identities) {
    const identityById = new Map<string, ProjectState['identities'][number]>(
      state.identities.map((i) => [i.id, i]),
    );
    const push = (deviceId: string, identityId: string) => {
      const identity = identityById.get(identityId);
      if (!identity) return;
      const chips = identityChipsByDevice.get(deviceId) ?? [];
      if (chips.some((c) => c.id === identity.id)) return;
      chips.push({
        id: identity.id,
        label: identity.scope === 'domain' ? `${identity.domain}\\${identity.name}` : identity.name,
        scope: identity.scope,
      });
      identityChipsByDevice.set(deviceId, chips);
    };
    for (const identity of state.identities) {
      if (identity.deviceId) push(identity.deviceId, identity.id);
    }
    for (const assignment of state.roleAssignments) {
      if (assignment.deviceId) push(assignment.deviceId, assignment.identityId);
    }
  }

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
    const modeHidden = !modeVisible(device.lifecycleState, options.mode);
    const hidden =
      modeHidden || (zone ? collapsed.has(zone.siteId) || collapsedZones.has(zone.id) : false);
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
      data: {
        device,
        memberships,
        primaryIp: primaryIpByDevice.get(device.id) ?? null,
        showTint: options.logical,
        confidence: deviceConfidence.get(device.id) ?? null,
        evidenceCount: deviceEvidence.get(device.id)?.size ?? 0,
        identityChips: identityChipsByDevice.get(device.id) ?? [],
        diffState: diffStateOf(device.lifecycleState, options.mode),
      },
      hidden,
    });
  }

  // Links render between the owning Devices, bundled per device pair: multiple
  // records between the same pair collapse into one expandable edge (§3.3).
  const deviceByInterface = new Map(state.interfaces.map((i) => [i.id, i.deviceId]));
  const bundles = new Map<string, Link[]>();
  for (const link of options.physical ? state.links : []) {
    if (!modeVisible(link.lifecycleState, options.mode)) continue;
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
      type: edgeType,
      ...portDots,
      data: { linkIds: bundleLinks.map((l) => l.id) },
      style: { stroke: '#8b94a7', strokeWidth: single ? 1.5 : 2.5 },
      label: single ? first.label || first.kind : `${bundleLinks.length} links`,
      labelStyle: { fill: '#d7dde8', fontSize: 10 },
      labelBgStyle: { fill: '#161a22' },
    });
  }

  // Observed traffic (Phase 2): aggregated Flows render as bundled dashed
  // edges between the resolved devices — one edge per device pair (§3.3).
  if (options.observed) {
    const resolveFlowDevice = (endpoint: Flow['source']): string | null => {
      if (endpoint.kind === 'device') return endpoint.id;
      if (endpoint.kind === 'interface') return deviceByInterface.get(endpoint.id) ?? null;
      return null;
    };
    const flowBundles = new Map<string, Flow[]>();
    for (const flow of state.flows) {
      if (!modeVisible(flow.lifecycleState, options.mode)) continue;
      const sourceDevice = resolveFlowDevice(flow.source);
      const targetDevice = resolveFlowDevice(flow.destination);
      if (!sourceDevice || !targetDevice) continue;
      if (hiddenDeviceIds.has(sourceDevice) || hiddenDeviceIds.has(targetDevice)) continue;
      const key = `${sourceDevice}~${targetDevice}`;
      const bundle = flowBundles.get(key) ?? [];
      bundle.push(flow);
      flowBundles.set(key, bundle);
    }
    for (const [key, bundle] of flowBundles) {
      const first = bundle[0];
      if (!first) continue;
      const sourceDevice = resolveFlowDevice(first.source) ?? '';
      const targetDevice = resolveFlowDevice(first.destination) ?? '';
      const observations = bundle.reduce((sum, f) => sum + f.observationCount, 0);
      const label =
        bundle.length === 1
          ? `${first.protocol}${first.port !== null ? `/${first.port}` : ''} ×${observations}`
          : `${bundle.length} flows ×${observations}`;
      edges.push({
        id: `flows-${key}`,
        source: sourceDevice,
        target: targetDevice,
        sourceHandle: 'link-out',
        targetHandle: 'link-in',
        type: edgeType,
        animated: true,
        data: { flowIds: bundle.map((f) => f.id) },
        style: { stroke: '#e5b455', strokeDasharray: '4 3', opacity: 0.8 },
        label,
        labelStyle: { fill: '#e5b455', fontSize: 9 },
        labelBgStyle: { fill: '#161a22' },
      });
    }
  }

  if (options.logical) {
    let fallbackX = 80;
    for (const network of state.networks) {
      if (!modeVisible(network.lifecycleState, options.mode)) continue;
      const position: XY = network.layoutHints['main'] ?? { x: fallbackX, y: -140 };
      fallbackX += 220;
      nodes.push({
        id: network.id,
        type: 'network',
        position,
        data: { network, color: networkColor(state, network.id) },
      });
    }

    // Every Membership draws (M2 prototype verdict, issue #44): one solid
    // colored edge per interface — a 20-member fan in a single color stays
    // legible, and hiding endpoint edges orphans the bottom row.
    for (const iface of state.interfaces) {
      if (!iface.networkId) continue;
      if (hiddenDeviceIds.has(iface.deviceId)) continue;
      const color = networkColor(state, iface.networkId);
      // solid and colored; the interface-name label is revealed on
      // hover/selection by the M3 CSS label policy
      edges.push({
        id: `membership-${iface.id}`,
        source: iface.deviceId,
        target: iface.networkId,
        sourceHandle: 'membership',
        targetHandle: 'members',
        type: edgeType,
        ...portDots,
        data: { interfaceName: iface.name },
        style: { stroke: color, strokeWidth: 1.5, opacity: 0.9 },
        label: iface.name,
        labelStyle: { fill: color, fontSize: 9 },
        labelBgStyle: { fill: '#161a22' },
      });
    }
  }

  return { nodes, edges };
}
