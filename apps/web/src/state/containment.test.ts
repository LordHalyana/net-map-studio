import { describe, expect, it } from 'vitest';
import { projectStateSchema, type ProjectState } from '@netplan/domain';
import { makeDevice, makeNetwork, makeProject, makeSite, makeZone } from '@netplan/domain/fixtures';
import { toAbsolute, toZoneRelative } from './containment';
import { opRestoreAbsolutePosition, opSetNetworkLayoutHint } from './ops';

function parseState(partial: Record<string, unknown>): ProjectState {
  return projectStateSchema.parse({
    sites: [],
    zones: [],
    devices: [],
    interfaces: [],
    addresses: [],
    networks: [],
    links: [],
    services: [],
    policyRules: [],
    ...partial,
  });
}

/** A Device at (5, 7) inside a Zone at (30, 40) inside a Site at (100, 200). */
function makeContainedScene() {
  const project = makeProject();
  const site = makeSite(project.id, { position: { x: 100, y: 200 } });
  const zone = makeZone(site, { position: { x: 30, y: 40 } });
  const device = makeDevice(project.id, { zoneId: zone.id, position: { x: 5, y: 7 } });
  const state = parseState({ project, sites: [site], zones: [zone], devices: [device] });
  return { state, site, zone, device };
}

describe('toAbsolute', () => {
  it('walks the Containment hierarchy: site + zone + device offsets (ADR-0013)', () => {
    const { state, device } = makeContainedScene();
    expect(toAbsolute(device, state)).toEqual({ x: 135, y: 247 });
  });

  it('leaves an open-canvas device (no zone) untouched — its position is already absolute', () => {
    const project = makeProject();
    const device = makeDevice(project.id, { position: { x: 5, y: 7 } });
    const state = parseState({ project, devices: [device] });
    expect(toAbsolute(device, state)).toEqual({ x: 5, y: 7 });
  });

  it('treats a dangling zone reference as the origin instead of throwing', () => {
    const { state, device } = makeContainedScene();
    const orphaned = parseState({ project: state.project, devices: [device] });
    expect(toAbsolute(device, orphaned)).toEqual({ x: 5, y: 7 });
  });
});

describe('toZoneRelative', () => {
  it('converts an absolute point into zone-relative coordinates', () => {
    const { state, zone } = makeContainedScene();
    expect(toZoneRelative({ x: 135, y: 247 }, zone, state)).toEqual({ x: 5, y: 7 });
  });

  it('round-trips with toAbsolute for a contained device', () => {
    const { state, zone, device } = makeContainedScene();
    expect(toZoneRelative(toAbsolute(device, state), zone, state)).toEqual(device.position);
  });
});

describe('opRestoreAbsolutePosition', () => {
  it('writes the absolute position a device keeps when it leaves its zone', () => {
    const { state, device } = makeContainedScene();
    expect(opRestoreAbsolutePosition(state.project.id, device, state)).toMatchObject({
      kind: 'SetField',
      entityType: 'device',
      entityId: device.id,
      field: 'position',
      value: { x: 135, y: 247 },
      previousValue: { x: 5, y: 7 },
    });
  });
});

describe('opSetNetworkLayoutHint', () => {
  it('writes the moved position as a per-view layout hint, never a device position (ADR-0013)', () => {
    const project = makeProject();
    const network = makeNetwork(project.id, {
      layoutHints: { main: { x: 1, y: 2 }, print: { x: 9, y: 9 } },
    });
    const op = opSetNetworkLayoutHint(project.id, network, 'main', { x: 50, y: 60 });
    expect(op).toMatchObject({
      kind: 'SetField',
      entityType: 'network',
      entityId: network.id,
      field: 'layoutHints',
      value: { main: { x: 50, y: 60 }, print: { x: 9, y: 9 } },
      previousValue: { main: { x: 1, y: 2 }, print: { x: 9, y: 9 } },
    });
  });

  it('returns null when the view already holds that position — no no-op writes', () => {
    const project = makeProject();
    const network = makeNetwork(project.id, { layoutHints: { main: { x: 50, y: 60 } } });
    expect(opSetNetworkLayoutHint(project.id, network, 'main', { x: 50, y: 60 })).toBeNull();
  });

  it('emits for a view with no hint yet, whatever the coordinates', () => {
    const project = makeProject();
    const network = makeNetwork(project.id);
    const op = opSetNetworkLayoutHint(project.id, network, 'main', { x: 0, y: 0 });
    expect(op).toMatchObject({ value: { main: { x: 0, y: 0 } } });
  });
});
