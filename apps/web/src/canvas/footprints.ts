import type { Device, Position, ProjectState, Site, Size, Zone } from '@netplan/domain';

/**
 * Footprints (#78): the single home for the rectangles nodes paint on the
 * canvas. "What footprint does this node have" was answered independently by
 * the canvas projection, Auto-arrange and the container shrink clamps, and
 * the copies drifted (the clamp believed a Device card was 170×64). All
 * three consume this one resolver, so a footprint change lands in one place
 * and every consumer follows.
 *
 * Footprints are declared constants, not measured DOM — measuring at runtime
 * is explicitly out of scope for #78.
 */

export type Rect = Position & Size;

/** Full Device card — generous enough that long names/IPs never make siblings touch (M4, #61). */
const DEVICE_CARD_SIZE: Size = { width: 190, height: 64 };
/** Leaf-endpoint mini-node (M4, #61). */
const COMPACT_NODE_SIZE: Size = { width: 52, height: 44 };
/** Network-node card (the concept's VLAN rectangle, M2). */
const NETWORK_NODE_SIZE: Size = { width: 200, height: 52 };

const SITE_SIZE: Size = { width: 460, height: 300 };
const SITE_COLLAPSED_SIZE: Size = { width: 200, height: 48 };
const ZONE_SIZE: Size = { width: 200, height: 150 };
const ZONE_COLLAPSED_SIZE: Size = { width: 170, height: 34 };

/** Breathing room the shrink clamps keep around the furthest contained child (M1, #58). */
const CONTAINER_PADDING = 16;

/**
 * Leaf-endpoint density (M4, #61; revisits divergence #51 as usability):
 * degree-1 devices in endpoint categories render as compact mini-nodes once
 * the scene is big enough for full cards to collide.
 */
const COMPACT_ENDPOINT_TYPES = new Set<Device['deviceType']>([
  'workstation',
  'laptop',
  'mobileDevice',
  'posClient',
  'paymentTerminal',
  'printer',
  'camera',
  'voipDevice',
  'iotDevice',
]);
const COMPACT_LEAF_MIN_DEVICES = 9;

/** The devices that render compact (M4, #61) — one rule for canvas AND auto-arrange. */
function compactLeafDeviceIds(state: ProjectState): Set<string> {
  if (state.devices.length < COMPACT_LEAF_MIN_DEVICES) return new Set();
  const deviceByInterface = new Map(state.interfaces.map((i) => [i.id, i.deviceId]));
  const degree = new Map<string, number>();
  const bump = (deviceId: string | null | undefined) => {
    if (deviceId) degree.set(deviceId, (degree.get(deviceId) ?? 0) + 1);
  };
  for (const link of state.links) {
    bump(deviceByInterface.get(link.source.id));
    bump(deviceByInterface.get(link.target.id));
  }
  for (const iface of state.interfaces) {
    if (iface.networkId) bump(iface.deviceId);
  }
  return new Set(
    state.devices
      .filter((d) => COMPACT_ENDPOINT_TYPES.has(d.deviceType) && (degree.get(d.id) ?? 0) <= 1)
      .map((d) => d.id),
  );
}

/**
 * View state the resolver needs beyond ProjectState: collapse is per-view,
 * not stored. Auto-arrange deliberately passes no view, so its Site obstacles
 * keep their expanded footprints and the no-overlap guarantee survives
 * expanding a collapsed Site (#75).
 */
export type FootprintView = {
  collapsedSites?: readonly string[];
  collapsedZones?: readonly string[];
};

export interface Footprints {
  /** Rendered Device card: full card, or the mini-node for a compact leaf. */
  device(deviceId: string): Size;
  /** The compact-leaf rule (M4, #61) — one rule so canvas and arrange never disagree. */
  isCompactLeaf(deviceId: string): boolean;
  /** Rendered network-node card. */
  network(): Size;
  /** Rendered Site rect: collapsed if the view says so, else declared ?? default. */
  siteRect(site: Site): Rect;
  /** Rendered Zone size: collapsed if the view says so, else declared ?? default. */
  zoneSize(zone: Zone): Size;
  /** Shrink-clamp minimum: resizing a Zone can never clip a contained Device. */
  zoneMinSize(zoneId: string): Size;
  /** Shrink-clamp minimum: resizing a Site can never clip a contained Zone. */
  siteMinSize(siteId: string): Size;
}

/** Smallest size keeping every child's rendered footprint inside, plus padding. */
function enclosingMin(floor: Size, children: Iterable<Rect>): Size {
  let { width, height } = floor;
  for (const child of children) {
    width = Math.max(width, child.x + child.width + CONTAINER_PADDING);
    height = Math.max(height, child.y + child.height + CONTAINER_PADDING);
  }
  return { width, height };
}

/**
 * Per-scene resolver: a Device's footprint depends on scene-wide state (the
 * compact-leaf rule needs the whole graph) and the clamp minimums are
 * per-scene aggregates, so the answers hang off `state`, not bare constants.
 */
export function footprints(state: ProjectState, view: FootprintView = {}): Footprints {
  // lazy: clamp-only consumers never pay the graph-wide degree scan
  let compactLeaves: Set<string> | null = null;
  const leaves = () => (compactLeaves ??= compactLeafDeviceIds(state));
  const collapsedSites = new Set(view.collapsedSites ?? []);
  const collapsedZones = new Set(view.collapsedZones ?? []);

  const zoneSize = (zone: Zone): Size =>
    collapsedZones.has(zone.id) ? ZONE_COLLAPSED_SIZE : (zone.size ?? ZONE_SIZE);

  return {
    device: (deviceId) => (leaves().has(deviceId) ? COMPACT_NODE_SIZE : DEVICE_CARD_SIZE),
    isCompactLeaf: (deviceId) => leaves().has(deviceId),
    network: () => NETWORK_NODE_SIZE,
    siteRect: (site) => ({
      ...site.position,
      ...(collapsedSites.has(site.id) ? SITE_COLLAPSED_SIZE : (site.size ?? SITE_SIZE)),
    }),
    zoneSize,
    zoneMinSize: (zoneId) =>
      // Full card even for compact leaves: selecting a compact leaf restores
      // its full card, so clamping to the mini-node could clip the selection.
      enclosingMin(
        ZONE_COLLAPSED_SIZE,
        state.devices
          .filter((d) => d.zoneId === zoneId)
          .map((d) => ({ ...d.position, ...DEVICE_CARD_SIZE })),
      ),
    siteMinSize: (siteId) =>
      enclosingMin(
        SITE_COLLAPSED_SIZE,
        state.zones
          .filter((z) => z.siteId === siteId)
          .map((z) => ({ ...z.position, ...zoneSize(z) })),
      ),
  };
}
