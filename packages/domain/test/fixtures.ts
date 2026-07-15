import {
  addressIdSchema,
  addressSchema,
  deviceIdSchema,
  deviceSchema,
  interfaceIdSchema,
  interfaceSchema,
  linkIdSchema,
  linkSchema,
  networkIdSchema,
  networkSchema,
  newId,
  policyRuleIdSchema,
  policyRuleSchema,
  projectIdSchema,
  projectSchema,
  serviceIdSchema,
  serviceSchema,
  siteIdSchema,
  siteSchema,
  zoneIdSchema,
  zoneSchema,
  type Address,
  type Device,
  type Interface,
  type Link,
  type Network,
  type PolicyRule,
  type Project,
  type ProjectId,
  type Service,
  type Site,
  type Zone,
} from '../src/index.js';

/** Parse-based fixtures: defaults are filled by the schemas themselves. */

export function makeProject(overrides: Partial<Project> = {}): Project {
  return projectSchema.parse({
    id: newId(projectIdSchema),
    name: 'Test Project',
    createdAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  });
}

export function makeSite(projectId: ProjectId, overrides: Partial<Site> = {}): Site {
  return siteSchema.parse({
    id: newId(siteIdSchema),
    projectId,
    name: 'HQ',
    ...overrides,
  });
}

export function makeZone(site: Site, overrides: Partial<Zone> = {}): Zone {
  return zoneSchema.parse({
    id: newId(zoneIdSchema),
    projectId: site.projectId,
    siteId: site.id,
    name: 'Server Room',
    ...overrides,
  });
}

export function makeDevice(projectId: ProjectId, overrides: Partial<Device> = {}): Device {
  return deviceSchema.parse({
    id: newId(deviceIdSchema),
    projectId,
    name: 'core-router',
    deviceType: 'router',
    ...overrides,
  });
}

export function makeInterface(device: Device, overrides: Partial<Interface> = {}): Interface {
  return interfaceSchema.parse({
    id: newId(interfaceIdSchema),
    projectId: device.projectId,
    deviceId: device.id,
    name: 'eth0',
    ...overrides,
  });
}

export function makeAddress(iface: Interface, overrides: Partial<Address> = {}): Address {
  return addressSchema.parse({
    id: newId(addressIdSchema),
    projectId: iface.projectId,
    interfaceId: iface.id,
    kind: 'ipv4',
    value: '10.0.0.1',
    ...overrides,
  });
}

export function makeNetwork(projectId: ProjectId, overrides: Partial<Network> = {}): Network {
  return networkSchema.parse({
    id: newId(networkIdSchema),
    projectId,
    name: 'Staff VLAN',
    kind: 'vlan',
    vlanId: 10,
    ...overrides,
  });
}

export function makeLink(a: Interface, b: Interface, overrides: Partial<Link> = {}): Link {
  return linkSchema.parse({
    id: newId(linkIdSchema),
    projectId: a.projectId,
    source: { kind: 'interface', id: a.id },
    target: { kind: 'interface', id: b.id },
    ...overrides,
  });
}

export function makeService(projectId: ProjectId, overrides: Partial<Service> = {}): Service {
  return serviceSchema.parse({
    id: newId(serviceIdSchema),
    projectId,
    name: 'HTTPS',
    protocol: 'tcp',
    portStart: 443,
    portEnd: 443,
    ...overrides,
  });
}

export function makePolicyRule(
  source: Network,
  destination: Network,
  overrides: Partial<PolicyRule> = {},
): PolicyRule {
  return policyRuleSchema.parse({
    id: newId(policyRuleIdSchema),
    projectId: source.projectId,
    source: { kind: 'network', id: source.id },
    destination: { kind: 'network', id: destination.id },
    action: 'allow',
    ...overrides,
  });
}
