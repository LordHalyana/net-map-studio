import { z } from 'zod';
import { deviceIdSchema, interfaceIdSchema, networkIdSchema, zoneIdSchema } from './ids.js';
import type { DeviceId } from './ids.js';
import type { Device, Interface, Network, Zone } from './entities.js';
import type { ProjectState } from './state.js';

/**
 * One end of a connection as a polymorphic `(kind, id)` reference (ADR-0012).
 * Referential integrity across the polymorphic reference is validated in the
 * domain layer on the Operation mutation path, not by a DB constraint.
 *
 * A `subnet` endpoint references a Network entity of kind `subnet` — the
 * distinction from `network` is authoring intent (address range vs. named
 * network), both resolve against the Network table.
 */
const interfaceEndpoint = z.object({ kind: z.literal('interface'), id: interfaceIdSchema });
const deviceEndpoint = z.object({ kind: z.literal('device'), id: deviceIdSchema });
const networkEndpoint = z.object({ kind: z.literal('network'), id: networkIdSchema });
const zoneEndpoint = z.object({ kind: z.literal('zone'), id: zoneIdSchema });
const subnetEndpoint = z.object({ kind: z.literal('subnet'), id: networkIdSchema });

export const endpointSchema = z.discriminatedUnion('kind', [
  interfaceEndpoint,
  deviceEndpoint,
  networkEndpoint,
  zoneEndpoint,
  subnetEndpoint,
]);
export type Endpoint = z.infer<typeof endpointSchema>;

/**
 * A Flow endpoint (ADR-0019/0020): entity reference when the endpoint is a
 * known object, or an `external` address literal when it is not — an observed
 * communication must never invent a Device for an unknown peer.
 */
export const flowEndpointSchema = z.discriminatedUnion('kind', [
  interfaceEndpoint,
  deviceEndpoint,
  networkEndpoint,
  zoneEndpoint,
  subnetEndpoint,
  z.object({ kind: z.literal('external'), value: z.string().min(1) }),
]);
export type FlowEndpoint = z.infer<typeof flowEndpointSchema>;

/** A Link terminates on Interfaces only (ADR-0012): port-level fidelity. */
export const linkEndpointSchema = z.object({
  kind: z.literal('interface'),
  id: interfaceIdSchema,
});
export type LinkEndpoint = z.infer<typeof linkEndpointSchema>;

/** PolicyRules (and Phase-2 Flows) may target any endpoint kind. */
export const policyEndpointSchema = endpointSchema;
export type PolicyEndpoint = z.infer<typeof policyEndpointSchema>;

export function isValidLinkEndpoint(endpoint: Endpoint): endpoint is LinkEndpoint {
  return linkEndpointSchema.safeParse(endpoint).success;
}

export function isValidPolicyEndpoint(endpoint: Endpoint): boolean {
  return policyEndpointSchema.safeParse(endpoint).success;
}

/** The entity a `(kind, id)` reference denotes; `subnet` denotes a Network. */
export type EndpointEntity = Device | Interface | Network | Zone;

/**
 * How far `touchesDevice` widens "references device D" (ADR-0012 resolution):
 * `direct` — D itself or one of D's interfaces; `membership` — also a Network
 * one of D's interfaces is a member of; `zone` — also D's Zone.
 */
export type EndpointTouchScope = 'direct' | 'membership' | 'zone';

export interface EndpointResolver {
  /** The referenced entity, or null when the reference dangles or is external. */
  entity(endpoint: FlowEndpoint): EndpointEntity | null;
  /**
   * Display label: the entity's name; an interface composes its owning device
   * ("Server-1 · eth0"); a dangling reference reads "(deleted <kind>)"; an
   * external literal reads "<value> (external)".
   */
  label(endpoint: FlowEndpoint): string;
  /** The device an endpoint sits on: the device itself or an interface's owner. */
  deviceId(endpoint: FlowEndpoint): DeviceId | null;
  /** Whether the endpoint references the device at the given scope. */
  touchesDevice(endpoint: FlowEndpoint, deviceId: DeviceId, scope: EndpointTouchScope): boolean;
}

/**
 * The one home for resolving a polymorphic Endpoint (#80): panels, canvas
 * projection, the engine's relationship reads and the export renderers all
 * consume this instead of hand-writing the kind fan-out, graph lookup and
 * fallback rules. Per-state resolver like `footprints(state)` — lookups are
 * Map-backed and built lazily, so single-shot consumers stay cheap.
 */
export function endpointResolver(state: ProjectState): EndpointResolver {
  let deviceById: Map<string, Device> | null = null;
  let interfaceById: Map<string, Interface> | null = null;
  let networkById: Map<string, Network> | null = null;
  let zoneById: Map<string, Zone> | null = null;
  const devices = () => (deviceById ??= new Map(state.devices.map((d) => [d.id, d])));
  const interfaces = () => (interfaceById ??= new Map(state.interfaces.map((i) => [i.id, i])));
  const networks = () => (networkById ??= new Map(state.networks.map((n) => [n.id, n])));
  const zones = () => (zoneById ??= new Map(state.zones.map((z) => [z.id, z])));

  const deviceId = (endpoint: FlowEndpoint): DeviceId | null => {
    if (endpoint.kind === 'device') return endpoint.id;
    if (endpoint.kind === 'interface') return interfaces().get(endpoint.id)?.deviceId ?? null;
    return null;
  };

  const memberOf = (networkId: string, ownerId: DeviceId): boolean =>
    state.interfaces.some((i) => i.deviceId === ownerId && i.networkId === networkId);

  return {
    entity: (endpoint) => {
      switch (endpoint.kind) {
        case 'interface':
          return interfaces().get(endpoint.id) ?? null;
        case 'device':
          return devices().get(endpoint.id) ?? null;
        case 'network':
        case 'subnet':
          return networks().get(endpoint.id) ?? null;
        case 'zone':
          return zones().get(endpoint.id) ?? null;
        case 'external':
          return null;
      }
    },
    label: (endpoint) => {
      switch (endpoint.kind) {
        case 'external':
          return `${endpoint.value} (external)`;
        case 'interface': {
          const iface = interfaces().get(endpoint.id);
          if (!iface) return '(deleted interface)';
          const owner = devices().get(iface.deviceId);
          return owner ? `${owner.name} · ${iface.name}` : iface.name;
        }
        case 'device':
          return devices().get(endpoint.id)?.name ?? '(deleted device)';
        case 'network':
        case 'subnet':
          return networks().get(endpoint.id)?.name ?? '(deleted network)';
        case 'zone':
          return zones().get(endpoint.id)?.name ?? '(deleted zone)';
      }
    },
    deviceId,
    touchesDevice: (endpoint, target, scope) => {
      if (deviceId(endpoint) === target) return true;
      if (scope === 'direct') return false;
      if (endpoint.kind === 'network' || endpoint.kind === 'subnet') {
        return memberOf(endpoint.id, target);
      }
      return scope === 'zone' && endpoint.kind === 'zone'
        ? devices().get(target)?.zoneId === endpoint.id
        : false;
    },
  };
}
