/**
 * Stable tint per Network (visual-parity M0, gap G2). Colors are assigned by
 * hashing the network id into the VLAN palette, probing forward on collision
 * in id order. UUIDv7 ids sort by creation time, so adding a network never
 * recolors an existing one; removals only shift networks that had probed past
 * the removed slot (a collision chain, rare below palette size).
 * Hexes live in palette.ts, mirroring the --vlan-* tokens in styles.css.
 */
import { NETWORK_FALLBACK, VLAN_PALETTE } from './palette';

export { VLAN_PALETTE };

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function networkColorMap(
  networks: readonly { id: string; color?: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  const taken = new Set<number>();
  // operator-pinned colors win (M6, #63); pinned palette hues also reserve
  // their slot so the hash never hands the same hue to a second network
  for (const network of networks) {
    if (!network.color) continue;
    map.set(network.id, network.color);
    const slot = VLAN_PALETTE.indexOf(network.color);
    if (slot >= 0) taken.add(slot);
  }
  const sorted = [...networks]
    .filter((n) => !n.color)
    .map((n) => n.id)
    .sort();
  for (const id of sorted) {
    let slot = fnv1a(id) % VLAN_PALETTE.length;
    if (taken.size < VLAN_PALETTE.length) {
      while (taken.has(slot)) slot = (slot + 1) % VLAN_PALETTE.length;
    }
    taken.add(slot);
    map.set(id, VLAN_PALETTE[slot] ?? NETWORK_FALLBACK);
  }
  return map;
}

export function networkColor(
  state: { networks: readonly { id: string; color?: string | null }[] },
  networkId: string,
): string {
  return networkColorMap(state.networks).get(networkId) ?? NETWORK_FALLBACK;
}
