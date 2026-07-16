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
