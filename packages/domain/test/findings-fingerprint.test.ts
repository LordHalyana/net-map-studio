import { describe, expect, it } from 'vitest';
import {
  affectedKey,
  computeFingerprint,
  hashString,
  stableHash,
  stableStringify,
  type PolicyEndpoint,
} from '../src/index.js';
import { makeDevice, makeProject, makeSite, makeZone } from '@netplan/domain/fixtures';

/**
 * #110 B3: the fingerprint utilities ARE the persisted ADR-0023 contract —
 * an analyst's disposition survives re-runs only if the same real issue
 * hashes to the same fingerprint on every platform, every run. These are
 * deliberate below-the-engine-seam tests.
 */

const project = makeProject();
const devA = makeDevice(project.id);
const devB = makeDevice(project.id);
const zone = makeZone(makeSite(project.id));

describe('stableStringify', () => {
  it('is invariant to object key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('produces canonical JSON with sorted keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('preserves array order (order is meaning, not noise)', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(3)).toBe('3');
    expect(stableStringify(undefined)).toBe('null');
  });
});

describe('hashString / stableHash', () => {
  it('is deterministic and hex-shaped', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs when input differs', () => {
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('keeps tuple parts from bleeding into each other', () => {
    expect(stableHash('ab', 'c')).not.toBe(stableHash('a', 'bc'));
  });
});

describe('computeFingerprint (ADR-0023 disposition join key)', () => {
  const affected: PolicyEndpoint = { kind: 'device', id: devA.id };

  it('is stable for identical inputs', () => {
    expect(computeFingerprint('rule.x', affected, 'salient')).toBe(
      computeFingerprint('rule.x', { ...affected }, 'salient'),
    );
  });

  it('differs across each salient dimension', () => {
    const base = computeFingerprint('rule.x', affected, 'salient');
    expect(computeFingerprint('rule.y', affected, 'salient')).not.toBe(base);
    expect(computeFingerprint('rule.x', { kind: 'device', id: devB.id }, 'salient')).not.toBe(base);
    expect(computeFingerprint('rule.x', { kind: 'zone', id: zone.id }, 'salient')).not.toBe(base);
    expect(computeFingerprint('rule.x', affected, 'other')).not.toBe(base);
  });

  it('maps a null affected to the network-wide key', () => {
    expect(affectedKey(null)).toBe('network:*');
    expect(computeFingerprint('rule.x', null, 's')).toBe(stableHash('rule.x', 'network:*', 's'));
  });

  it('composes the affected key as kind:id — re-run join stability', () => {
    // If this composition changes, every persisted disposition detaches.
    expect(affectedKey(affected)).toBe(`device:${devA.id}`);
    expect(computeFingerprint('rule.x', affected, 'salient')).toBe(
      stableHash('rule.x', `device:${devA.id}`, 'salient'),
    );
  });
});
