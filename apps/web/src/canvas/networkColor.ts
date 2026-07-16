/**
 * Stable tint per Network (visual-parity M0, gap G2). Colors are assigned by
 * hashing the network id into the VLAN palette, probing forward on collision
 * in id order. UUIDv7 ids sort by creation time, so adding a network never
 * recolors an existing one; removals only shift networks that had probed past
 * the removed slot (a collision chain, rare below palette size).
 */
export const VLAN_PALETTE = [
  '#ff8a3d', // staff orange
  '#3ddc97', // guest green
  '#a06bff', // pos purple
  '#ffc44d', // cctv amber
  '#4da3ff', // blue
  '#5bd0d0', // teal
  '#e06c6c', // red
  '#9fd05b', // lime
];

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function networkColorMap(networks: readonly { id: string }[]): Map<string, string> {
  const sorted = [...networks].map((n) => n.id).sort();
  const taken = new Set<number>();
  const map = new Map<string, string>();
  for (const id of sorted) {
    let slot = fnv1a(id) % VLAN_PALETTE.length;
    if (taken.size < VLAN_PALETTE.length) {
      while (taken.has(slot)) slot = (slot + 1) % VLAN_PALETTE.length;
    }
    taken.add(slot);
    map.set(id, VLAN_PALETTE[slot] ?? '#4da3ff');
  }
  return map;
}

export function networkColor(
  state: { networks: readonly { id: string }[] },
  networkId: string,
): string {
  return networkColorMap(state.networks).get(networkId) ?? '#4da3ff';
}
