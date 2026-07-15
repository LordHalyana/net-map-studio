import {
  addressIdSchema,
  addressSchema,
  changeSetIdSchema,
  deviceIdSchema,
  deviceSchema,
  interfaceIdSchema,
  interfaceSchema,
  newId,
  operationIdSchema,
  operationSchema,
  type Address,
  type ChangeSet,
  type Device,
  type DeviceType,
  type EntityPayload,
  type Interface,
  type InterfaceId,
  type NetworkId,
  type Operation,
  type Position,
  type ProjectId,
  type ProjectState,
  type SettableEntityType,
  type ZoneId,
} from '@netplan/domain';

/**
 * Operation builders — the client half of the ADR-0010 spine. The client
 * mints UUIDv7s (ADR-0015) so objects exist before any server round-trip.
 */

export function opCreateEntity(projectId: ProjectId, payload: EntityPayload): Operation {
  return { id: newId(operationIdSchema), projectId, kind: 'CreateEntity', payload };
}

export function opDeleteEntity(projectId: ProjectId, payload: EntityPayload): Operation {
  return { id: newId(operationIdSchema), projectId, kind: 'DeleteEntity', payload };
}

export function opCreateDevice(projectId: ProjectId, device: Device): Operation {
  return opCreateEntity(projectId, { entityType: 'device', entity: device });
}

export function opSetField(
  projectId: ProjectId,
  entityType: SettableEntityType,
  entityId: string,
  field: string,
  value: unknown,
  previousValue: unknown,
): Operation {
  // parse() both validates the JSON-ness of the values and types the result.
  return operationSchema.parse({
    id: newId(operationIdSchema),
    projectId,
    kind: 'SetField',
    entityType,
    entityId,
    field,
    value: value ?? null,
    previousValue: previousValue ?? null,
  });
}

export function opSetMembership(
  projectId: ProjectId,
  interfaceId: InterfaceId,
  networkId: NetworkId | null,
  previousNetworkId: NetworkId | null,
): Operation {
  return {
    id: newId(operationIdSchema),
    projectId,
    kind: 'SetMembership',
    interfaceId,
    networkId,
    previousNetworkId,
  };
}

export function opSetContainment(
  projectId: ProjectId,
  deviceId: Device['id'],
  zoneId: ZoneId | null,
  previousZoneId: ZoneId | null,
): Operation {
  return {
    id: newId(operationIdSchema),
    projectId,
    kind: 'SetContainment',
    deviceId,
    zoneId,
    previousZoneId,
  };
}

export function changeSet(projectId: ProjectId, label: string, operations: Operation[]): ChangeSet {
  return { id: newId(changeSetIdSchema), projectId, label, operations };
}

/** Mint a new Device for the canvas with a locally-unique default name. */
export function buildDevice(
  projectId: ProjectId,
  deviceType: DeviceType,
  position: Position,
  existingNames: ReadonlySet<string>,
): Device {
  let index = 1;
  while (existingNames.has(`${deviceType}-${index}`)) index += 1;
  const name = `${deviceType}-${index}`;
  return deviceSchema.parse({
    id: newId(deviceIdSchema),
    projectId,
    name,
    deviceType,
    position,
  });
}

export function buildInterface(
  device: Device,
  name: string,
  overrides: Partial<Pick<Interface, 'kind' | 'networkId'>> = {},
): Interface {
  return interfaceSchema.parse({
    id: newId(interfaceIdSchema),
    projectId: device.projectId,
    deviceId: device.id,
    name,
    ...overrides,
  });
}

export function buildAddress(iface: Interface, kind: Address['kind'], value: string): Address {
  return addressSchema.parse({
    id: newId(addressIdSchema),
    projectId: iface.projectId,
    interfaceId: iface.id,
    kind,
    value,
  });
}

/** Everything that must go when a set of Devices goes — one atomic ChangeSet. */
export function deleteDevicesChangeSet(state: ProjectState, deviceIds: string[]): ChangeSet | null {
  const targets = state.devices.filter((d) => deviceIds.includes(d.id));
  if (targets.length === 0) return null;
  const targetDeviceIds = new Set(targets.map((d) => d.id));
  const ifaces = state.interfaces.filter((i) => targetDeviceIds.has(i.deviceId));
  const ifaceIds = new Set<string>(ifaces.map((i) => i.id));
  const projectId = state.project.id;

  const ops: Operation[] = [];

  for (const rule of state.policyRules) {
    const touches = [rule.source, rule.destination].some(
      (e) =>
        (e.kind === 'device' && targetDeviceIds.has(e.id)) ||
        (e.kind === 'interface' && ifaceIds.has(e.id)),
    );
    if (touches) {
      ops.push({
        id: newId(operationIdSchema),
        projectId,
        kind: 'DeletePolicyRule',
        ruleId: rule.id,
        snapshot: rule,
      });
    }
  }

  for (const link of state.links) {
    if (ifaceIds.has(link.source.id) || ifaceIds.has(link.target.id)) {
      ops.push({
        id: newId(operationIdSchema),
        projectId,
        kind: 'DeleteLink',
        linkId: link.id,
        snapshot: link,
      });
    }
  }

  for (const address of state.addresses) {
    if (ifaceIds.has(address.interfaceId)) {
      ops.push(opDeleteEntity(projectId, { entityType: 'address', entity: address }));
    }
  }

  for (const service of state.services) {
    if (service.deviceId && targetDeviceIds.has(service.deviceId)) {
      ops.push(opDeleteEntity(projectId, { entityType: 'service', entity: service }));
    }
  }

  for (const iface of ifaces) {
    ops.push(opDeleteEntity(projectId, { entityType: 'interface', entity: iface }));
  }

  for (const device of targets) {
    ops.push(opDeleteEntity(projectId, { entityType: 'device', entity: device }));
  }

  const label =
    targets.length === 1 ? `Delete ${targets[0]?.name}` : `Delete ${targets.length} devices`;
  return changeSet(projectId, label, ops);
}

/** Duplicate Devices with their Interfaces and Addresses, fresh ids, offset positions. */
export function duplicateDevicesChangeSet(
  state: ProjectState,
  deviceIds: string[],
): ChangeSet | null {
  const targets = state.devices.filter((d) => deviceIds.includes(d.id));
  if (targets.length === 0) return null;
  const projectId = state.project.id;
  const existingNames = new Set(state.devices.map((d) => d.name));
  const ops: Operation[] = [];

  for (const device of targets) {
    let name: string;
    let copy = 0;
    do {
      copy += 1;
      name = `${device.name}-copy${copy > 1 ? `-${copy}` : ''}`;
    } while (existingNames.has(name));
    existingNames.add(name);

    const clone = deviceSchema.parse({
      ...device,
      id: newId(deviceIdSchema),
      name,
      position: { x: device.position.x + 48, y: device.position.y + 48 },
    });
    ops.push(opCreateEntity(projectId, { entityType: 'device', entity: clone }));

    for (const iface of state.interfaces.filter((i) => i.deviceId === device.id)) {
      const ifaceClone = interfaceSchema.parse({
        ...iface,
        id: newId(interfaceIdSchema),
        deviceId: clone.id,
      });
      ops.push(opCreateEntity(projectId, { entityType: 'interface', entity: ifaceClone }));
      for (const address of state.addresses.filter((a) => a.interfaceId === iface.id)) {
        const addressClone = addressSchema.parse({
          ...address,
          id: newId(addressIdSchema),
          interfaceId: ifaceClone.id,
        });
        ops.push(opCreateEntity(projectId, { entityType: 'address', entity: addressClone }));
      }
    }
  }

  const label =
    targets.length === 1 ? `Duplicate ${targets[0]?.name}` : `Duplicate ${targets.length} devices`;
  return changeSet(projectId, label, ops);
}
