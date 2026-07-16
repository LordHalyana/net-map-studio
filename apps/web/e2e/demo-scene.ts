/**
 * Visual-parity demo scene (M0, issue #42): recreates the concept image's
 * hotel topology through the real Operation log so every milestone can be
 * compared like-for-like against docs/concept_design_netplanner.png.
 *
 * Idempotent: if a project named DEMO_PROJECT_NAME already exists it is left
 * untouched and returned.
 */
import {
  deviceIdSchema,
  deviceSchema,
  networkIdSchema,
  networkSchema,
  newId,
  projectSchema,
  siteIdSchema,
  siteSchema,
  zoneIdSchema,
  zoneSchema,
  type Device,
  type Interface,
  type Network,
  type Operation,
  type Position,
  type Project,
  type Zone,
} from '@netplan/domain';
import { z } from 'zod';
import {
  buildAddress,
  buildInterface,
  buildLink,
  buildPolicyRule,
  buildService,
  changeSet,
  opCreateEntity,
  opCreateLink,
  opCreatePolicyRule,
} from '../src/state/ops';

export const DEMO_PROJECT_NAME = 'Hotel Network Plan';

async function api<T>(base: string, path: string, schema: z.ZodType<T>, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status}`);
  return schema.parse(await response.json());
}

interface DeviceSpec {
  name: string;
  deviceType: Device['deviceType'];
  position: Position;
  customTypeLabel?: string;
  vendor?: string;
  model?: string;
  /** Containment (ADR-0013): position becomes zone-relative. */
  zoneId?: Zone['id'];
}

function demoDevice(projectId: string, spec: DeviceSpec): Device {
  return deviceSchema.parse({
    id: newId(deviceIdSchema),
    projectId,
    name: spec.name,
    deviceType: spec.deviceType,
    customTypeLabel: spec.customTypeLabel ?? '',
    vendor: spec.vendor ?? '',
    model: spec.model ?? '',
    status: 'active',
    position: spec.position,
    zoneId: spec.zoneId ?? null,
  });
}

interface NetworkSpec {
  name: string;
  vlanId: number;
  cidr: string;
  position: Position;
}

function demoNetwork(projectId: string, spec: NetworkSpec): Network {
  return networkSchema.parse({
    id: newId(networkIdSchema),
    projectId,
    name: spec.name,
    kind: 'vlan',
    vlanId: spec.vlanId,
    cidr: spec.cidr,
    layoutHints: { main: spec.position },
  });
}

/**
 * Seed (or find) the demo project on a running server; returns the Project.
 * `stress` adds the two cases the concept image dodges — a 20-member IoT
 * VLAN and a dual-homed device — for judging fan-out and multi-membership.
 * `structure` adds a Site with two Zones and zoned devices so Containment
 * (collapse/expand, zone moves) has data to exercise (local-dev seed).
 */
export async function seedDemoScene(
  apiBase: string,
  options: { stress?: boolean; structure?: boolean } = {},
): Promise<Project> {
  const projects = await api(apiBase, '/projects', z.array(projectSchema));
  const existing = projects.find((p) => p.name === DEMO_PROJECT_NAME);
  if (existing) return existing;

  const project = await api(apiBase, '/projects', projectSchema, {
    method: 'POST',
    body: JSON.stringify({ name: DEMO_PROJECT_NAME }),
  });
  const pid = project.id;
  const ops: Operation[] = [];

  // -- networks (concept: four access VLANs + servers VLAN) --
  const staff = demoNetwork(pid, {
    name: 'Staff VLAN 10',
    vlanId: 10,
    cidr: '192.168.10.0/24',
    position: { x: 250, y: 540 },
  });
  const guest = demoNetwork(pid, {
    name: 'Guest VLAN 20',
    vlanId: 20,
    cidr: '192.168.20.0/24',
    position: { x: 490, y: 540 },
  });
  const servers = demoNetwork(pid, {
    name: 'Servers VLAN 30',
    vlanId: 30,
    cidr: '192.168.30.0/24',
    position: { x: 950, y: 360 },
  });
  const pos = demoNetwork(pid, {
    name: 'POS VLAN 40',
    vlanId: 40,
    cidr: '192.168.40.0/24',
    position: { x: 730, y: 540 },
  });
  const cctv = demoNetwork(pid, {
    name: 'CCTV VLAN 50',
    vlanId: 50,
    cidr: '192.168.50.0/24',
    position: { x: 970, y: 540 },
  });
  const networks = [staff, guest, servers, pos, cctv];
  for (const network of networks) {
    ops.push(opCreateEntity(pid, { entityType: 'network', entity: network }));
  }

  // -- core devices --
  const internet = demoDevice(pid, {
    name: 'Internet',
    deviceType: 'custom',
    customTypeLabel: 'Internet',
    position: { x: 610, y: 20 },
  });
  const firewall = demoDevice(pid, {
    name: 'Firewall',
    deviceType: 'firewall',
    vendor: 'Fortinet',
    model: 'FortiGate 60F',
    position: { x: 600, y: 180 },
  });
  const vpn = demoDevice(pid, {
    name: 'VPN Gateway',
    deviceType: 'vpnGateway',
    position: { x: 870, y: 180 },
  });
  const core = demoDevice(pid, {
    name: 'Core Switch',
    deviceType: 'switch',
    position: { x: 590, y: 360 },
  });
  const fileServer = demoDevice(pid, {
    name: 'File Server',
    deviceType: 'server',
    position: { x: 1200, y: 360 },
  });

  // -- endpoints, three per access VLAN (concept bottom row) --
  const endpointSpecs: { device: DeviceSpec; network: Network; ip: string }[] = [];
  const fanOut = (
    network: Network,
    baseX: number,
    prefix: string,
    deviceType: Device['deviceType'],
    subnet: number,
  ) => {
    for (let i = 0; i < 3; i++) {
      endpointSpecs.push({
        device: {
          name: `${prefix} ${i + 1}`,
          deviceType,
          position: { x: baseX + i * 90, y: 720 },
        },
        network,
        ip: `192.168.${subnet}.${11 + i}`,
      });
    }
  };
  fanOut(staff, 160, 'Staff PC', 'workstation', 10);
  fanOut(guest, 430, 'Guest Phone', 'mobileDevice', 20);
  fanOut(cctv, 940, 'Camera', 'camera', 50);
  endpointSpecs.push(
    {
      device: { name: 'POS Terminal', deviceType: 'posClient', position: { x: 700, y: 720 } },
      network: pos,
      ip: '192.168.40.11',
    },
    {
      device: {
        name: 'Payment Terminal',
        deviceType: 'paymentTerminal',
        position: { x: 800, y: 720 },
      },
      network: pos,
      ip: '192.168.40.12',
    },
    {
      device: { name: 'POS Printer', deviceType: 'printer', position: { x: 890, y: 720 } },
      network: pos,
      ip: '192.168.40.13',
    },
  );

  const coreDevices = [internet, firewall, vpn, core, fileServer];
  const endpointDevices = endpointSpecs.map((spec) => demoDevice(pid, spec.device));
  for (const device of [...coreDevices, ...endpointDevices]) {
    ops.push(opCreateEntity(pid, { entityType: 'device', entity: device }));
  }

  // -- interfaces & addresses --
  const pushIface = (iface: Interface, ip?: string) => {
    ops.push(opCreateEntity(pid, { entityType: 'interface', entity: iface }));
    if (ip) {
      ops.push(
        opCreateEntity(pid, { entityType: 'address', entity: buildAddress(iface, 'ipv4', ip) }),
      );
    }
    return iface;
  };

  const internetWan = pushIface(buildInterface(internet, 'wan0'), '100.64.0.1');
  const fwWan = pushIface(buildInterface(firewall, 'wan'), '100.64.0.2');
  const fwLan = pushIface(buildInterface(firewall, 'lan'), '192.168.0.1');
  const fwDmz = pushIface(buildInterface(firewall, 'dmz'), '192.168.99.1');
  const vpnEth = pushIface(buildInterface(vpn, 'eth0'), '192.168.0.2');
  const coreUplink = pushIface(buildInterface(core, 'uplink'), '192.168.0.10');
  // core switch access interfaces carry the VLAN Memberships (ADR-0013)
  for (const network of networks) {
    pushIface(buildInterface(core, `vlan${network.vlanId}`, { networkId: network.id }));
  }
  const serverEth = pushIface(
    buildInterface(fileServer, 'eth0', { networkId: servers.id }),
    '192.168.30.10',
  );
  void serverEth;
  endpointDevices.forEach((device, index) => {
    const spec = endpointSpecs[index];
    if (!spec) return;
    pushIface(buildInterface(device, 'eth0', { networkId: spec.network.id }), spec.ip);
  });

  // -- stress cases (M2 prototype): 20-member VLAN + a dual-homed device --
  if (options.stress) {
    const iot = demoNetwork(pid, {
      name: 'IoT VLAN 60',
      vlanId: 60,
      cidr: '192.168.60.0/24',
      position: { x: 1210, y: 540 },
    });
    ops.push(opCreateEntity(pid, { entityType: 'network', entity: iot }));
    for (let i = 0; i < 20; i++) {
      const sensor = demoDevice(pid, {
        name: `Sensor ${i + 1}`,
        deviceType: 'iotDevice',
        position: { x: 1130 + (i % 5) * 95, y: 840 + Math.floor(i / 5) * 70 },
      });
      ops.push(opCreateEntity(pid, { entityType: 'device', entity: sensor }));
      pushIface(buildInterface(sensor, 'eth0', { networkId: iot.id }), `192.168.60.${11 + i}`);
    }
    const dualHomed = demoDevice(pid, {
      name: 'Office Printer',
      deviceType: 'printer',
      position: { x: 560, y: 860 },
    });
    ops.push(opCreateEntity(pid, { entityType: 'device', entity: dualHomed }));
    pushIface(buildInterface(dualHomed, 'eth0', { networkId: staff.id }), '192.168.10.40');
    pushIface(buildInterface(dualHomed, 'eth1', { networkId: pos.id }), '192.168.40.40');
  }

  // -- structure (local-dev seed): Site › Zones › zoned devices (ADR-0013) --
  if (options.structure) {
    const site = siteSchema.parse({
      id: newId(siteIdSchema),
      projectId: pid,
      name: 'Main Office',
      position: { x: 60, y: 1000 },
    });
    const serverRoom = zoneSchema.parse({
      id: newId(zoneIdSchema),
      projectId: pid,
      siteId: site.id,
      name: 'Server Room',
      kind: 'rack',
      position: { x: 20, y: 44 },
    });
    const frontDesk = zoneSchema.parse({
      id: newId(zoneIdSchema),
      projectId: pid,
      siteId: site.id,
      name: 'Front Desk',
      kind: 'room',
      position: { x: 240, y: 44 },
    });
    ops.push(
      opCreateEntity(pid, { entityType: 'site', entity: site }),
      opCreateEntity(pid, { entityType: 'zone', entity: serverRoom }),
      opCreateEntity(pid, { entityType: 'zone', entity: frontDesk }),
    );
    const rackSwitch = demoDevice(pid, {
      name: 'Rack Switch',
      deviceType: 'switch',
      position: { x: 24, y: 48 },
      zoneId: serverRoom.id,
    });
    const frontDeskPc = demoDevice(pid, {
      name: 'Front Desk PC',
      deviceType: 'workstation',
      position: { x: 24, y: 48 },
      zoneId: frontDesk.id,
    });
    ops.push(
      opCreateEntity(pid, { entityType: 'device', entity: rackSwitch }),
      opCreateEntity(pid, { entityType: 'device', entity: frontDeskPc }),
    );
    pushIface(buildInterface(rackSwitch, 'eth0', { networkId: servers.id }), '192.168.30.20');
    pushIface(buildInterface(frontDeskPc, 'eth0', { networkId: staff.id }), '192.168.10.30');
  }

  // -- links (concept trunk lines) --
  ops.push(opCreateLink(pid, buildLink(pid, internetWan.id, fwWan.id, 'cable', 'uplink')));
  ops.push(opCreateLink(pid, buildLink(pid, fwLan.id, coreUplink.id, 'cable', 'trunk')));
  ops.push(opCreateLink(pid, buildLink(pid, fwDmz.id, vpnEth.id, 'cable', '')));

  // -- services & policy rules (concept callouts) --
  const https = buildService(pid, { name: 'HTTPS', protocol: 'tcp', portStart: 443 });
  const openvpn = buildService(pid, { name: 'VPN (OpenVPN)', protocol: 'udp', portStart: 1194 });
  const posSvc = buildService(pid, {
    name: 'POS',
    protocol: 'tcp',
    portStart: 8001,
    portEnd: 8002,
  });
  for (const service of [https, openvpn, posSvc]) {
    ops.push(opCreateEntity(pid, { entityType: 'service', entity: service }));
  }
  ops.push(
    opCreatePolicyRule(
      pid,
      buildPolicyRule(pid, {
        name: 'Allow staff HTTPS to servers',
        source: { kind: 'network', id: staff.id },
        destination: { kind: 'network', id: servers.id },
        action: 'allow',
        serviceId: https.id,
      }),
    ),
    opCreatePolicyRule(
      pid,
      buildPolicyRule(pid, {
        name: 'Allow VPN to gateway',
        source: { kind: 'device', id: internet.id },
        destination: { kind: 'device', id: vpn.id },
        action: 'allow',
        serviceId: openvpn.id,
      }),
    ),
    opCreatePolicyRule(
      pid,
      buildPolicyRule(pid, {
        name: 'POS terminals to servers only',
        source: { kind: 'network', id: pos.id },
        destination: { kind: 'network', id: servers.id },
        action: 'allow',
        serviceId: posSvc.id,
        logging: true,
      }),
    ),
    opCreatePolicyRule(
      pid,
      buildPolicyRule(pid, {
        name: 'Deny guest to servers',
        source: { kind: 'network', id: guest.id },
        destination: { kind: 'network', id: servers.id },
        action: 'deny',
        logging: true,
      }),
    ),
  );

  await api(apiBase, `/projects/${pid}/operations`, z.unknown(), {
    method: 'POST',
    body: JSON.stringify(changeSet(pid, 'Seed visual-parity demo scene', ops)),
  });
  return project;
}
