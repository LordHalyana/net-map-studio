import { endpointResolver, type EndpointResolver } from './endpoints.js';
import type { Endpoint, FlowEndpoint } from './endpoints.js';
import type { Device } from './entities.js';
import type { ProjectState } from './state.js';

/**
 * Per-run resolution index (#110 B1): the one place `(kind, id)` references
 * resolve inside the findings engine and rule validation. It wraps the
 * endpoint resolver (#80) — so the kind fan-out lives in exactly one module —
 * and precomputes the two membership maps (device → networks, device by id)
 * that rules previously rebuilt by scanning state per check.
 *
 * Built once per engine run and handed to rules via `RuleContext`; detection
 * stays derived-per-run (ADR-0023), so the index is never persisted.
 */
export interface ResolutionIndex {
  /** The underlying shared resolver — labels, entity lookup, touch checks. */
  resolver: EndpointResolver;
  device(id: string): Device | undefined;
  /** The known Device a flow endpoint resolves to, or undefined — never fabricated. */
  flowEndpointDevice(endpoint: FlowEndpoint): Device | undefined;
  /** Networks a device's interfaces are members of. */
  deviceNetworkIds(deviceId: string): ReadonlySet<string>;
  /** Does a PolicyRule endpoint resolve to (cover) this device — directly, by zone, or by network? */
  endpointCoversDevice(endpoint: Endpoint, device: Device): boolean;
  /** Is there an intended `allow` PolicyRule sanctioning traffic between two devices? */
  policyAllows(src: Device, dst: Device): boolean;
  /** Does the endpoint reference a live entity? `subnet` aliases the Network table. */
  endpointExists(endpoint: Endpoint): boolean;
}

const NO_NETWORKS: ReadonlySet<string> = new Set();

export function buildResolutionIndex(state: ProjectState): ResolutionIndex {
  const resolver = endpointResolver(state);
  const devicesById = new Map<string, Device>(state.devices.map((d) => [d.id, d]));

  const networksByDevice = new Map<string, Set<string>>();
  for (const iface of state.interfaces) {
    if (!iface.networkId) continue;
    let networks = networksByDevice.get(iface.deviceId);
    if (!networks) networksByDevice.set(iface.deviceId, (networks = new Set()));
    networks.add(iface.networkId);
  }

  const deviceNetworkIds = (deviceId: string): ReadonlySet<string> =>
    networksByDevice.get(deviceId) ?? NO_NETWORKS;

  const endpointCoversDevice = (endpoint: Endpoint, device: Device): boolean => {
    switch (endpoint.kind) {
      case 'zone':
        return device.zoneId != null && endpoint.id === device.zoneId;
      case 'network':
      case 'subnet':
        return deviceNetworkIds(device.id).has(endpoint.id);
      case 'device':
      case 'interface':
        return resolver.deviceId(endpoint) === device.id;
    }
  };

  // Memoized per ordered device pair: Flows repeat pairs heavily and the rule
  // set is fixed for the run, so each pair is decided at most once.
  const allowRules = state.policyRules.filter((rule) => rule.action === 'allow');
  const allowCache = new Map<string, boolean>();
  const policyAllows = (src: Device, dst: Device): boolean => {
    const key = `${src.id} ${dst.id}`;
    const cached = allowCache.get(key);
    if (cached !== undefined) return cached;
    const allowed = allowRules.some((rule) => {
      const forward =
        endpointCoversDevice(rule.source, src) && endpointCoversDevice(rule.destination, dst);
      const reverse =
        rule.direction === 'bidirectional' &&
        endpointCoversDevice(rule.source, dst) &&
        endpointCoversDevice(rule.destination, src);
      return forward || reverse;
    });
    allowCache.set(key, allowed);
    return allowed;
  };

  return {
    resolver,
    device: (id) => devicesById.get(id),
    flowEndpointDevice: (endpoint) => {
      const id = resolver.deviceId(endpoint);
      return id == null ? undefined : devicesById.get(id);
    },
    deviceNetworkIds,
    endpointCoversDevice,
    policyAllows,
    endpointExists: (endpoint) => resolver.entity(endpoint) !== null,
  };
}
