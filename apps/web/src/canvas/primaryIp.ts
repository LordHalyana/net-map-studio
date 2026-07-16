import type { Address, Interface } from '@netplan/domain';

type AddressBook = {
  interfaces: readonly Interface[];
  addresses: readonly Address[];
};

/**
 * Primary address per Device (M1, gap G1): the first ipv4 across its
 * Interfaces, falling back to ipv6. One definition shared by the canvas
 * projection, the inspector header and the link endpoint cards.
 */
export function primaryIpByDevice(state: AddressBook): Map<string, string> {
  const owner = new Map(state.interfaces.map((i) => [i.id, i.deviceId]));
  const map = new Map<string, string>();
  for (const kind of ['ipv4', 'ipv6'] as const) {
    for (const address of state.addresses) {
      if (address.kind !== kind) continue;
      const deviceId = owner.get(address.interfaceId);
      if (deviceId && !map.has(deviceId)) map.set(deviceId, address.value);
    }
  }
  return map;
}

export function primaryIp(state: AddressBook, deviceId: string): string | null {
  return primaryIpByDevice(state).get(deviceId) ?? null;
}
