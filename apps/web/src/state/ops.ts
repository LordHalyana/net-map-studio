import {
  deviceIdSchema,
  deviceSchema,
  newId,
  operationIdSchema,
  operationSchema,
  type Device,
  type DeviceType,
  type Operation,
  type Position,
  type ProjectId,
  type SettableEntityType,
} from '@netplan/domain';

/**
 * Operation builders — the client half of the ADR-0010 spine. The client
 * mints UUIDv7s (ADR-0015) so objects exist before any server round-trip.
 */

export function opCreateDevice(projectId: ProjectId, device: Device): Operation {
  return {
    id: newId(operationIdSchema),
    projectId,
    kind: 'CreateEntity',
    payload: { entityType: 'device', entity: device },
  };
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

let deviceCounter = 0;

/** Mint a new Device for the canvas with a locally-unique default name. */
export function buildDevice(
  projectId: ProjectId,
  deviceType: DeviceType,
  position: Position,
  existingNames: ReadonlySet<string>,
): Device {
  let name: string;
  do {
    deviceCounter += 1;
    name = `${deviceType}-${deviceCounter}`;
  } while (existingNames.has(name));
  return deviceSchema.parse({
    id: newId(deviceIdSchema),
    projectId,
    name,
    deviceType,
    position,
  });
}
