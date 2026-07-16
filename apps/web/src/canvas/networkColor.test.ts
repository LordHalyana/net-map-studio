import { describe, expect, it } from 'vitest';
import { VLAN_PALETTE, networkColorMap } from './networkColor';

const nets = (...ids: string[]) => ids.map((id) => ({ id }));

describe('networkColorMap', () => {
  it('is deterministic for the same set of networks', () => {
    const a = networkColorMap(nets('n-1', 'n-2', 'n-3'));
    const b = networkColorMap(nets('n-1', 'n-2', 'n-3'));
    expect(a).toEqual(b);
  });

  it('assigns only palette colors', () => {
    const map = networkColorMap(nets('n-1', 'n-2', 'n-3', 'n-4'));
    for (const color of map.values()) expect(VLAN_PALETTE).toContain(color);
  });

  it('gives distinct colors while the palette is not exhausted', () => {
    const ids = VLAN_PALETTE.map((_, i) => `net-${i}`);
    const map = networkColorMap(nets(...ids));
    expect(new Set(map.values()).size).toBe(VLAN_PALETTE.length);
  });

  it('keeps existing colors when a later-created network is added', () => {
    // UUIDv7 ids are time-ordered, so a new network always sorts last.
    const before = networkColorMap(nets('a', 'b', 'c'));
    const after = networkColorMap(nets('a', 'b', 'c', 'z'));
    for (const [id, color] of before) expect(after.get(id)).toBe(color);
  });

  it('does not depend on array order', () => {
    const a = networkColorMap(nets('a', 'b', 'c'));
    const b = networkColorMap(nets('c', 'a', 'b'));
    expect(a).toEqual(b);
  });

  it('wraps deterministically once the palette is exhausted', () => {
    const ids = [...VLAN_PALETTE, 'overflow'].map((_, i) => `net-${i}`);
    const map = networkColorMap(nets(...ids));
    expect(map.size).toBe(ids.length);
    for (const color of map.values()) expect(VLAN_PALETTE).toContain(color);
  });
});
