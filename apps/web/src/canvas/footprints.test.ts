import { describe, expect, it } from 'vitest';
import { projectStateSchema, type ProjectState } from '@netplan/domain';
import {
  makeDevice,
  makeInterface,
  makeNetwork,
  makeProject,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';
import { footprints } from './footprints';

const FULL_CARD = { width: 190, height: 64 };
const COMPACT = { width: 52, height: 44 };

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

/**
 * Nine devices (the compact-leaf threshold): one degree-1 workstation that
 * renders compact, one dual-homed workstation and one server that stay full.
 */
function makeCompactScene() {
  const project = makeProject();
  const pid = project.id;
  const vlan = makeNetwork(pid);
  const guest = makeNetwork(pid, { name: 'Guest', vlanId: 20 });

  const leaf = makeDevice(pid, { name: 'leaf', deviceType: 'workstation' });
  const dualHomed = makeDevice(pid, { name: 'dual', deviceType: 'workstation' });
  const server = makeDevice(pid, { name: 'srv', deviceType: 'server' });
  const filler = Array.from({ length: 6 }, (_, i) =>
    makeDevice(pid, { name: `filler-${i}`, deviceType: 'server' }),
  );

  const state = parseState({
    project,
    devices: [leaf, dualHomed, server, ...filler],
    interfaces: [
      makeInterface(leaf, { networkId: vlan.id }),
      makeInterface(dualHomed, { name: 'eth0', networkId: vlan.id }),
      makeInterface(dualHomed, { name: 'eth1', networkId: guest.id }),
    ],
    networks: [vlan, guest],
  });
  return { state, leaf, dualHomed, server };
}

describe('footprints: device cards', () => {
  it('gives a degree-1 endpoint its compact-leaf footprint in a big scene', () => {
    const { state, leaf } = makeCompactScene();
    const fp = footprints(state);
    expect(fp.device(leaf.id)).toEqual(COMPACT);
    expect(fp.isCompactLeaf(leaf.id)).toBe(true);
  });

  it('keeps dual-homed endpoints and non-endpoint types full-size', () => {
    const { state, dualHomed, server } = makeCompactScene();
    const fp = footprints(state);
    expect(fp.device(dualHomed.id)).toEqual(FULL_CARD);
    expect(fp.device(server.id)).toEqual(FULL_CARD);
    expect(fp.isCompactLeaf(dualHomed.id)).toBe(false);
  });

  it('renders every card full-size below the compact-leaf scene threshold', () => {
    const project = makeProject();
    const vlan = makeNetwork(project.id);
    const leaf = makeDevice(project.id, { name: 'leaf', deviceType: 'workstation' });
    const state = parseState({
      project,
      devices: [leaf],
      interfaces: [makeInterface(leaf, { networkId: vlan.id })],
      networks: [vlan],
    });
    expect(footprints(state).device(leaf.id)).toEqual(FULL_CARD);
  });
});

describe('footprints: network-node card', () => {
  it('is the 200×52 rendered card', () => {
    const { state } = makeCompactScene();
    expect(footprints(state).network()).toEqual({ width: 200, height: 52 });
  });
});

describe('footprints: Site rect', () => {
  it('uses the declared size when the Site has one', () => {
    const project = makeProject();
    const site = makeSite(project.id, {
      position: { x: 40, y: 60 },
      size: { width: 700, height: 500 },
    });
    const state = parseState({ project, sites: [site] });
    expect(footprints(state).siteRect(site)).toEqual({ x: 40, y: 60, width: 700, height: 500 });
  });

  it('falls back to the default expanded size', () => {
    const project = makeProject();
    const site = makeSite(project.id, { position: { x: 40, y: 60 } });
    const state = parseState({ project, sites: [site] });
    expect(footprints(state).siteRect(site)).toEqual({ x: 40, y: 60, width: 460, height: 300 });
  });

  it('answers the collapsed header rect when the view collapses the Site', () => {
    const project = makeProject();
    const site = makeSite(project.id, {
      position: { x: 40, y: 60 },
      size: { width: 700, height: 500 },
    });
    const state = parseState({ project, sites: [site] });
    const fp = footprints(state, { collapsedSites: [site.id] });
    expect(fp.siteRect(site)).toEqual({ x: 40, y: 60, width: 200, height: 48 });
  });
});

describe('footprints: Zone size', () => {
  it('uses declared size, falling back to the default', () => {
    const project = makeProject();
    const site = makeSite(project.id);
    const sized = makeZone(site, { size: { width: 320, height: 240 } });
    const bare = makeZone(site, { name: 'Lobby' });
    const state = parseState({ project, sites: [site], zones: [sized, bare] });
    const fp = footprints(state);
    expect(fp.zoneSize(sized)).toEqual({ width: 320, height: 240 });
    expect(fp.zoneSize(bare)).toEqual({ width: 200, height: 150 });
    // the view wins over the declared size while the Zone is collapsed
    const collapsed = footprints(state, { collapsedZones: [sized.id] });
    expect(collapsed.zoneSize(sized)).toEqual({ width: 170, height: 34 });
  });
});

describe('footprints: Zone shrink-clamp minimum', () => {
  it('keeps the full card of the furthest zone-relative Device inside (Containment)', () => {
    const project = makeProject();
    const site = makeSite(project.id);
    const zone = makeZone(site);
    const near = makeDevice(project.id, {
      name: 'near',
      zoneId: zone.id,
      position: { x: 10, y: 10 },
    });
    const far = makeDevice(project.id, {
      name: 'far',
      zoneId: zone.id,
      position: { x: 120, y: 40 },
    });
    const state = parseState({ project, sites: [site], zones: [zone], devices: [near, far] });
    // furthest card corner + padding: 120+190+16 × 40+64+16
    expect(footprints(state).zoneMinSize(zone.id)).toEqual({ width: 326, height: 120 });
  });

  it('clamps with the full card even for a compact leaf (selection restores the full card)', () => {
    const { state } = makeCompactScene();
    const site = makeSite(state.project.id);
    const zone = makeZone(site);
    const withZoned: ProjectState = {
      ...state,
      sites: [site],
      zones: [zone],
      devices: state.devices.map((d, i) =>
        i === 0 ? { ...d, zoneId: zone.id, position: { x: 0, y: 0 } } : d,
      ),
    };
    const fp = footprints(withZoned);
    const zoned = withZoned.devices[0];
    expect(zoned && fp.isCompactLeaf(zoned.id)).toBe(true);
    expect(fp.zoneMinSize(zone.id)).toEqual({ width: 190 + 16, height: 64 + 16 });
  });

  it('floors at the collapsed-zone size when the Zone is empty', () => {
    const project = makeProject();
    const site = makeSite(project.id);
    const zone = makeZone(site);
    const state = parseState({ project, sites: [site], zones: [zone] });
    expect(footprints(state).zoneMinSize(zone.id)).toEqual({ width: 170, height: 34 });
  });
});

describe('footprints: Site shrink-clamp minimum', () => {
  function makeSiteScene() {
    const project = makeProject();
    const site = makeSite(project.id);
    const zone = makeZone(site, {
      position: { x: 30, y: 50 },
      size: { width: 320, height: 240 },
    });
    const state = parseState({ project, sites: [site], zones: [zone] });
    return { state, site, zone };
  }

  it('keeps the rendered rect of the furthest contained Zone inside', () => {
    const { state, site } = makeSiteScene();
    // zone corner + padding: 30+320+16 × 50+240+16
    expect(footprints(state).siteMinSize(site.id)).toEqual({ width: 366, height: 306 });
  });

  it('uses the collapsed size for a collapsed Zone (view state)', () => {
    const { state, site, zone } = makeSiteScene();
    const fp = footprints(state, { collapsedZones: [zone.id] });
    // collapsed zone renders 170×34: 30+170+16 × 50+34+16
    expect(fp.siteMinSize(site.id)).toEqual({ width: 216, height: 100 });
  });

  it('floors at the collapsed-site size when the Site is empty', () => {
    const project = makeProject();
    const site = makeSite(project.id);
    const state = parseState({ project, sites: [site] });
    expect(footprints(state).siteMinSize(site.id)).toEqual({ width: 200, height: 48 });
  });
});
