import type { Edge, Node } from '@xyflow/react';
import { PORT_DOT_MARKER } from './EdgeMarkerDefs';
import { EDGE_LABEL_BG, EDGE_LABEL_TEXT, EDGE_NEUTRAL, FLOW_AMBER } from './colors';
import {
  endpointResolver,
  type Device,
  type FieldProvenance,
  type Flow,
  type Link,
  type Network,
  type PolicyRule,
  type Position as XY,
  type ProjectState,
  type Severity,
  type Site,
  type Zone,
} from '@netplan/domain';

import { footprints } from './footprints';
import { networkColor, networkColorMap } from './networkColor';
import { primaryIpByDevice } from './primaryIp';

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
  /** Planned-rule callout cards (M4, gap G4). */
  rules: boolean;
  /** Findings layer (M5, #62): severity tint on affected devices. */
  findingsLayer: boolean;
  /** Open findings per device: count + worst severity (M5, #62). */
  openFindingsByDevice: Map<string, DeviceFindingsBadge>;
}

export type DeviceFindingsBadge = { count: number; severity: Severity };

export type PolicyRuleCalloutLine = {
  action: PolicyRule['action'];
  text: string;
  /** Clicking a line lands on this rule in the Rules tab (M3, #60). */
  ruleId: string;
};
export type PolicyRuleCalloutData = {
  lines: PolicyRuleCalloutLine[];
  more: number;
  ruleIds: string[];
  /** Direction (degrees) of the leader line back toward the subject (M4, #61). */
  leaderAngle: number;
};

/** Smoothstep edges accept lane offsets; the base Edge type omits them. */
type CanvasEdge = Edge & { pathOptions?: { offset?: number; borderRadius?: number } };

/** Perpendicular distance a rule callout sits from its subject (M4, #61). */
const CALLOUT_OFFSET = 110;

/** Lines a callout card shows before collapsing into "+n more" (M4). */
export const POLICY_RULE_CALLOUT_MAX_LINES = 3;

export type SiteNodeData = { site: Site; collapsed: boolean };
export type ZoneNodeData = { zone: Zone; collapsed: boolean };
export type NetworkNodeData = { network: Network; color: string };
export type DeviceNodeData = {
  device: Device;
  memberships: Membership[];
  /** Leaf-endpoint mini-node (M4, #61): icon + status only until selected. */
  compact: boolean;
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
  /** Open findings affecting this device (M5, #62); null = clean. */
  findings: DeviceFindingsBadge | null;
  /** Severity tint enabled (the findings layer toggle). */
  findingsTint: boolean;
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
  const edges: CanvasEdge[] = [];
  const deviceByInterface = new Map(state.interfaces.map((i) => [i.id, i.deviceId]));
  // the endpoint resolver (#80) answers "which device does this (kind, id)
  // reference sit on" for Flow edges and PolicyRule callout anchors below
  const endpoints = endpointResolver(state);
  // the footprint resolver (#78) answers every "what rectangle does this
  // node paint" question below — cards, container rects, collision rects
  const fp = footprints(state, {
    collapsedSites: options.collapsedSites,
    collapsedZones: options.collapsedZones,
  });
  // Orthogonal routing with port dots (M3 prototype verdict, issue #45):
  // smoothstep reads like the concept's right-angle lines at canvas zoom and
  // stays soft on dense fans. React Flow wraps the marker id in url(#...).
  const edgeType = 'smoothstep';
  const portDots = { markerStart: PORT_DOT_MARKER, markerEnd: PORT_DOT_MARKER };

  const zoneById = new Map(state.zones.map((z) => [z.id, z]));
  const hiddenDeviceIds = new Set<string>();
  const primaryIps = primaryIpByDevice(state);
  const tintByNetwork = networkColorMap(state.networks);
  const tint = (networkId: string) => tintByNetwork.get(networkId) ?? EDGE_NEUTRAL;

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
    const { width, height } = fp.siteRect(site);
    nodes.push({
      id: site.id,
      type: 'site',
      position: site.position,
      data: { site, collapsed: collapsed.has(site.id) },
      style: { width, height },
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
      style: { ...fp.zoneSize(zone) },
      hidden: siteCollapsed,
      zIndex: -10,
    });
  }

  for (const device of state.devices) {
    const card = fp.device(device.id);
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
        color: tint(i.networkId ?? ''),
        interfaceName: i.name,
      }));
    nodes.push({
      id: device.id,
      type: 'device',
      parentId: zone?.id,
      extent: zone ? 'parent' : undefined,
      position: device.position,
      // initial* advertise the footprint without fixing the CSS-driven size;
      // the agreement test (#78) reads them back against the resolver
      initialWidth: card.width,
      initialHeight: card.height,
      data: {
        device,
        memberships,
        compact: fp.isCompactLeaf(device.id),
        primaryIp: primaryIps.get(device.id) ?? null,
        showTint: options.logical,
        confidence: deviceConfidence.get(device.id) ?? null,
        evidenceCount: deviceEvidence.get(device.id)?.size ?? 0,
        identityChips: identityChipsByDevice.get(device.id) ?? [],
        diffState: diffStateOf(device.lifecycleState, options.mode),
        findings: options.openFindingsByDevice.get(device.id) ?? null,
        findingsTint: options.findingsLayer,
      },
      hidden,
    });
  }

  // Links render between the owning Devices, bundled per device pair: multiple
  // records between the same pair collapse into one expandable edge (§3.3).
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
      style: { stroke: EDGE_NEUTRAL, strokeWidth: single ? 1.5 : 2.5 },
      label: single ? first.label || first.kind : `${bundleLinks.length} links`,
      labelStyle: { fill: EDGE_LABEL_TEXT, fontSize: 10 },
      labelBgStyle: { fill: EDGE_LABEL_BG },
    });
  }

  // Observed traffic (Phase 2): aggregated Flows render as bundled dashed
  // edges between the resolved devices — one edge per device pair (§3.3).
  if (options.observed) {
    const resolveFlowDevice = (endpoint: Flow['source']): string | null =>
      endpoints.deviceId(endpoint);
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
        style: { stroke: FLOW_AMBER, strokeDasharray: '4 3', opacity: 0.8 },
        label,
        labelStyle: { fill: FLOW_AMBER, fontSize: 9 },
        labelBgStyle: { fill: EDGE_LABEL_BG },
      });
    }
  }

  const networkPositions = new Map<string, XY>();
  if (options.logical) {
    let fallbackX = 80;
    for (const network of state.networks) {
      if (!modeVisible(network.lifecycleState, options.mode)) continue;
      const position: XY = network.layoutHints['main'] ?? { x: fallbackX, y: -140 };
      fallbackX += 220;
      networkPositions.set(network.id, position);
      nodes.push({
        id: network.id,
        type: 'network',
        position,
        initialWidth: fp.network().width,
        initialHeight: fp.network().height,
        data: { network, color: tint(network.id) },
      });
    }

    // Every Membership draws (M2 prototype verdict, issue #44): one solid
    // colored edge per interface — a 20-member fan in a single color stays
    // legible, and hiding endpoint edges orphans the bottom row.
    for (const iface of state.interfaces) {
      if (!iface.networkId) continue;
      if (hiddenDeviceIds.has(iface.deviceId)) continue;
      const color = tint(iface.networkId);
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
        labelBgStyle: { fill: EDGE_LABEL_BG },
      });
    }
  }

  // PolicyRule callouts (M4, gap G4): the concept's allow/deny annotation
  // cards. Prototype verdict (issue #46): one card per (source, destination)
  // pair at the path midpoint — destination-grouping collides with adjacent
  // nodes, selection-only loses the concept's always-visible cards.
  if (options.rules) {
    const serviceById = new Map(state.services.map((s) => [s.id, s]));
    const deviceById = new Map(state.devices.map((d) => [d.id, d]));

    // the web-only anchor layer over the domain resolver (#80): pixel
    // positions and hidden-device filtering stay canvas knowledge
    const anchorOf = (endpoint: PolicyRule['source']): { id: string; position: XY } | null => {
      const deviceId = endpoints.deviceId(endpoint);
      if (deviceId) {
        const device = deviceById.get(deviceId);
        if (!device || hiddenDeviceIds.has(device.id)) return null;
        return { id: device.id, position: device.position };
      }
      if (endpoint.kind === 'network' || endpoint.kind === 'subnet') {
        const position = networkPositions.get(endpoint.id);
        return position ? { id: endpoint.id, position } : null;
      }
      return null;
    };

    // pushing callouts away from the scene centroid steers them into the
    // sparse side of their subject edge instead of onto a node row
    const anchored = [...state.devices.map((d) => d.position), ...networkPositions.values()];
    const centroid = anchored.reduce(
      (acc, p) => ({ x: acc.x + p.x / anchored.length, y: acc.y + p.y / anchored.length }),
      { x: 0, y: 0 },
    );

    // the rendered node rectangles for the collision nudge below
    const CALLOUT_SIZE = { width: 160, height: 72 };
    const nodeRects = [
      ...state.devices.map((d) => ({ ...d.position, ...fp.device(d.id) })),
      ...[...networkPositions.values()].map((p) => ({ ...p, ...fp.network() })),
    ];
    const collides = (p: XY) =>
      nodeRects.some(
        (r) =>
          p.x < r.x + r.width &&
          r.x < p.x + CALLOUT_SIZE.width &&
          p.y < r.y + r.height &&
          r.y < p.y + CALLOUT_SIZE.height,
      );

    const groups = new Map<
      string,
      { position: XY; direction: XY; leaderAngle: number; rules: PolicyRule[] }
    >();
    for (const rule of state.policyRules) {
      if (!modeVisible(rule.lifecycleState, options.mode)) continue;
      const source = anchorOf(rule.source);
      const destination = anchorOf(rule.destination);
      const anchor = destination ?? source;
      if (!anchor) continue;
      // offset the card perpendicular to its subject edge so connection
      // lines stop running through the callout band (M4, #61); the leader
      // angle points back at the subject midpoint
      let position: XY;
      let direction: XY;
      let leaderAngle: number;
      if (!source || !destination) {
        position = { x: anchor.position.x + fp.device(anchor.id).width, y: anchor.position.y - 10 };
        direction = { x: 1, y: 0 };
        leaderAngle = 180;
      } else {
        const mid = {
          x: (source.position.x + destination.position.x) / 2,
          y: (source.position.y + destination.position.y) / 2,
        };
        const dx = destination.position.x - source.position.x;
        const dy = destination.position.y - source.position.y;
        const length = Math.hypot(dx, dy) || 1;
        const normal = { x: -dy / length, y: dx / length };
        const outward = (mid.x - centroid.x) * normal.x + (mid.y - centroid.y) * normal.y;
        const side = outward >= 0 ? 1 : -1;
        direction = { x: side * normal.x, y: side * normal.y };
        position = {
          x: mid.x + direction.x * CALLOUT_OFFSET,
          y: mid.y + direction.y * CALLOUT_OFFSET,
        };
        leaderAngle = (Math.atan2(-direction.y, -direction.x) * 180) / Math.PI;
      }
      // nudge along the offset direction until the card sits clear of nodes
      for (let step = 0; step < 6 && collides(position); step++) {
        position = { x: position.x + direction.x * 50, y: position.y + direction.y * 50 };
      }
      const key = `${source?.id ?? 'none'}~${destination?.id ?? 'none'}`;
      const group = groups.get(key) ?? { position, direction, leaderAngle, rules: [] };
      group.rules.push(rule);
      groups.set(key, group);
    }

    // stagger cards whose midpoints land in the same neighbourhood so
    // parallel rules (staff/guest/pos → servers) don't stack
    const occupancy = new Map<string, number>();
    for (const [key, group] of groups) {
      const cell = `${Math.round(group.position.x / 90)}:${Math.round(group.position.y / 60)}`;
      const stacked = occupancy.get(cell) ?? 0;
      occupancy.set(cell, stacked + 1);
      group.position = { x: group.position.x, y: group.position.y + stacked * 58 };
      const lines: PolicyRuleCalloutLine[] = group.rules
        .slice(0, POLICY_RULE_CALLOUT_MAX_LINES)
        .map((rule) => {
          const service = rule.serviceId ? serviceById.get(rule.serviceId) : undefined;
          const port =
            service?.portStart != null
              ? service.portEnd != null && service.portEnd !== service.portStart
                ? ` (${service.portStart}-${service.portEnd})`
                : ` (${service.portStart})`
              : '';
          return {
            action: rule.action,
            text: service ? `${service.name}${port}` : 'All Other',
            ruleId: rule.id,
          };
        });
      nodes.push({
        id: `policy-rule-callout-${key}`,
        type: 'policyRuleCallout',
        position: group.position,
        data: {
          lines,
          more: Math.max(0, group.rules.length - POLICY_RULE_CALLOUT_MAX_LINES),
          ruleIds: group.rules.map((r) => r.id),
          leaderAngle: group.leaderAngle,
        } satisfies PolicyRuleCalloutData,
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 10,
      });
    }
  }

  // Parallel edge lanes (M4, #61): edges that share a device pair (a Link
  // bundle plus a Flow bundle, or several memberships to one network) fan out
  // via per-edge smoothstep offsets instead of stacking on one path.
  const byPair = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join('~');
    const pair = byPair.get(key) ?? [];
    pair.push(edge);
    byPair.set(key, pair);
  }
  for (const pair of byPair.values()) {
    if (pair.length < 2) continue;
    pair.forEach((edge, index) => {
      edge.pathOptions = { offset: 8 + index * 14, borderRadius: 5 };
    });
  }

  return { nodes, edges };
}
