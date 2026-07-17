import type { Device, Position, ProjectState, Zone } from '@netplan/domain';

/**
 * Containment positions (#83): the single home for ADR-0013's coordinate
 * rule — a Device's position is relative to its Zone, whose position is
 * relative to its Site. The conversion used to live as verbatim copies in
 * the ops builders and DeviceInspector, kept in sync only by discipline.
 */

/** A Device's absolute canvas position, walking Site › Zone › Device. */
export function toAbsolute(device: Device, graph: ProjectState): Position {
  const zone = graph.zones.find((z) => z.id === device.zoneId);
  const site = zone ? graph.sites.find((s) => s.id === zone.siteId) : undefined;
  return {
    x: (site?.position.x ?? 0) + (zone?.position.x ?? 0) + device.position.x,
    y: (site?.position.y ?? 0) + (zone?.position.y ?? 0) + device.position.y,
  };
}

/** The inverse: where an absolute canvas point lands inside a Zone. */
export function toZoneRelative(point: Position, zone: Zone, graph: ProjectState): Position {
  const site = graph.sites.find((s) => s.id === zone.siteId);
  return {
    x: point.x - (site?.position.x ?? 0) - zone.position.x,
    y: point.y - (site?.position.y ?? 0) - zone.position.y,
  };
}
