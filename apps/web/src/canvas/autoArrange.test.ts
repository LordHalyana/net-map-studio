import { describe, expect, it } from 'vitest';
import {
  projectStateSchema,
  type Operation,
  type Position,
  type ProjectState,
} from '@netplan/domain';
import {
  makeDevice,
  makeInterface,
  makeLink,
  makeNetwork,
  makeProject,
  makeSite,
} from '@netplan/domain/fixtures';
import { autoArrangeChangeSet } from './autoArrange';

/** Mini hotel topology: internet → firewall → core, one VLAN, two endpoints. */
function makeScene() {
  const project = makeProject();
  const pid = project.id;
  const internet = makeDevice(pid, { name: 'internet', deviceType: 'custom' });
  const firewall = makeDevice(pid, { name: 'firewall', deviceType: 'firewall' });
  const core = makeDevice(pid, { name: 'core', deviceType: 'switch' });
  const pc1 = makeDevice(pid, { name: 'pc1', deviceType: 'workstation' });
  const pc2 = makeDevice(pid, { name: 'pc2', deviceType: 'workstation' });

  const vlan = makeNetwork(pid, { name: 'Staff VLAN', kind: 'vlan', vlanId: 10 });

  const internetWan = makeInterface(internet, { name: 'wan0' });
  const fwWan = makeInterface(firewall, { name: 'wan' });
  const fwLan = makeInterface(firewall, { name: 'lan' });
  const coreUp = makeInterface(core, { name: 'uplink' });
  const coreVlan = makeInterface(core, { name: 'vlan10', networkId: vlan.id });
  const pc1Eth = makeInterface(pc1, { name: 'eth0', networkId: vlan.id });
  const pc2Eth = makeInterface(pc2, { name: 'eth0', networkId: vlan.id });

  const state: ProjectState = projectStateSchema.parse({
    project,
    sites: [],
    zones: [],
    devices: [internet, firewall, core, pc1, pc2],
    interfaces: [internetWan, fwWan, fwLan, coreUp, coreVlan, pc1Eth, pc2Eth],
    addresses: [],
    networks: [vlan],
    links: [makeLink(internetWan, fwWan), makeLink(fwLan, coreUp)],
    services: [],
    policyRules: [],
  });
  return { state, internet, firewall, core, pc1, pc2, vlan };
}

function arrangedPositions(ops: Operation[]) {
  const devices = new Map<string, Position>();
  const networks = new Map<string, Position>();
  for (const op of ops) {
    if (op.kind !== 'SetField') continue;
    if (op.entityType === 'device' && op.field === 'position') {
      devices.set(op.entityId, op.value as Position);
    }
    if (op.entityType === 'network' && op.field === 'layoutHints') {
      const hints = op.value as Record<string, Position>;
      const main = hints['main'];
      if (main) networks.set(op.entityId, main);
    }
  }
  return { devices, networks };
}

describe('autoArrangeChangeSet (hierarchical, visual-parity M2)', () => {
  it('layers internet → firewall → core → VLAN → endpoints top-to-bottom', () => {
    const { state, internet, firewall, core, pc1, pc2, vlan } = makeScene();
    const cs = autoArrangeChangeSet(state);
    expect(cs).not.toBeNull();
    const { devices, networks } = arrangedPositions(cs?.operations ?? []);

    const y = (id: string) => {
      const position = devices.get(id) ?? networks.get(id);
      if (!position) throw new Error(`no position for ${id}`);
      return position.y;
    };
    expect(y(internet.id)).toBeLessThan(y(firewall.id));
    expect(y(firewall.id)).toBeLessThan(y(core.id));
    expect(y(core.id)).toBeLessThan(y(vlan.id));
    expect(y(vlan.id)).toBeLessThan(y(pc1.id));
    expect(y(vlan.id)).toBeLessThan(y(pc2.id));
  });

  it('writes the network position as a layout hint, not a device position', () => {
    const { state, vlan } = makeScene();
    const cs = autoArrangeChangeSet(state);
    const { devices, networks } = arrangedPositions(cs?.operations ?? []);
    expect(networks.has(vlan.id)).toBe(true);
    expect(devices.has(vlan.id)).toBe(false);
  });

  it('leaves pinned devices where they are', () => {
    const { state, firewall } = makeScene();
    const pinned = {
      ...state,
      devices: state.devices.map((d) => (d.id === firewall.id ? { ...d, pinned: true } : d)),
    };
    const cs = autoArrangeChangeSet(pinned);
    const { devices } = arrangedPositions(cs?.operations ?? []);
    expect(devices.has(firewall.id)).toBe(false);
  });

  it('returns null when nothing is movable', () => {
    const { state } = makeScene();
    const allPinned = {
      ...state,
      devices: state.devices.map((d) => ({ ...d, pinned: true })),
    };
    expect(autoArrangeChangeSet(allPinned)).toBeNull();
  });
});

/**
 * Reserve-the-region obstacle avoidance (#75): the dagre layout knows nothing
 * about Site rects or pinned devices' real positions, so when the arranged
 * block would land on one, the whole block (device positions AND network
 * layout hints) translates straight down to 40px below the lowest obstacle
 * whose x-span overlaps the block's.
 */
describe('autoArrangeChangeSet obstacle avoidance (#75)', () => {
  /** Every arranged position keyed by id, devices and networks together. */
  function allPositions(state: ProjectState) {
    const cs = autoArrangeChangeSet(state);
    expect(cs).not.toBeNull();
    const { devices, networks } = arrangedPositions(cs?.operations ?? []);
    return new Map([...devices, ...networks]);
  }

  it('shifts the whole block below an overlapping Site rect, offsets intact', () => {
    const { state } = makeScene();
    const baseline = allPositions(state);

    // default SITE_SIZE is 460×300 at the origin — squarely over the block
    const site = makeSite(state.project.id, { position: { x: 0, y: 0 } });
    const shifted = allPositions({ ...state, sites: [site] });

    const deltas = new Set<string>();
    for (const [id, before] of baseline) {
      const after = shifted.get(id);
      if (!after) throw new Error(`no shifted position for ${id}`);
      deltas.add(`${after.x - before.x},${after.y - before.y}`);
    }
    expect(deltas.size).toBe(1); // one rigid translation for the whole block
    const [delta] = deltas;
    const [dx, dy] = (delta ?? '').split(',').map(Number);
    expect(dx).toBe(0); // straight down, matching TB rank direction
    expect(dy).toBeGreaterThan(0);
    // block top lands exactly 40px below the site bottom (y 0 + height 300)
    const top = Math.min(...[...shifted.values()].map((p) => p.y));
    expect(top).toBe(300 + 40);
  });

  it('dual role: a pinned device shapes ranks yet its footprint repels the block', () => {
    const { state } = makeScene();
    // full-card footprint (190×64) parked where the arranged block starts
    const anchor = makeDevice(state.project.id, {
      name: 'anchor',
      deviceType: 'server',
      pinned: true,
      position: { x: 100, y: 100 },
    });
    const withAnchor: ProjectState = { ...state, devices: [...state.devices, anchor] };

    const cs = autoArrangeChangeSet(withAnchor);
    const { devices } = arrangedPositions(cs?.operations ?? []);
    expect(devices.has(anchor.id)).toBe(false); // still no Operation moves it

    const shifted = allPositions(withAnchor);
    const top = Math.min(...[...shifted.values()].map((p) => p.y));
    expect(top).toBe(100 + 64 + 40); // 40px below the pinned card's bottom
  });

  it('leaves the layout pixel-identical when no obstacle overlaps', () => {
    const { state } = makeScene();
    const baseline = allPositions(state);
    const farAway = makeSite(state.project.id, { position: { x: 5000, y: 5000 } });
    expect(allPositions({ ...state, sites: [farAway] })).toEqual(baseline);
  });

  it('ignores an obstacle sitting in a gap between ranks (per-box, not bounding-box)', () => {
    const { state } = makeScene();
    const baseline = allPositions(state);
    // drop a small site inside the block's bounding box but in the empty
    // band between the top rank's bottom edge and the next rank
    const positions = [...baseline.values()];
    const topY = Math.min(...positions.map((p) => p.y));
    const topNode = positions.find((p) => p.y === topY);
    if (!topNode) throw new Error('no top node');
    const gapSite = makeSite(state.project.id, {
      position: { x: topNode.x, y: topY + 64 + 16 }, // below the full card, above the next rank (96px ranksep)
      size: { width: 24, height: 24 },
    });
    expect(allPositions({ ...state, sites: [gapSite] })).toEqual(baseline);
  });

  it('shifts below the lowest obstacle in the block x-span, not one off to the side', () => {
    const { state } = makeScene();
    const trigger = makeSite(state.project.id, { position: { x: 0, y: 0 } }); // 460×300
    const lowerButAside = makeSite(state.project.id, {
      name: 'Depot',
      position: { x: -2000, y: 600 }, // bottom edge 900, x-span ends at -1540
    });
    const shifted = allPositions({ ...state, sites: [trigger, lowerButAside] });
    const top = Math.min(...[...shifted.values()].map((p) => p.y));
    expect(top).toBe(300 + 40); // clears the trigger, ignores the aside site
  });
});
