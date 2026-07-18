import { describe, expect, it } from 'vitest';
import { makeNetwork, makeProject } from '@netplan/domain/fixtures';
import { networkTintsFor, resolverFor } from './derived';
import { emptyState } from '../state/test-helpers';

/** #110 D4: derived helpers are built once per graph version, app-wide. */
describe('graph-derived caches', () => {
  it('returns the same resolver for the same graph object', () => {
    const graph = emptyState();
    expect(resolverFor(graph)).toBe(resolverFor(graph));
  });

  it('builds a fresh resolver for a new graph version', () => {
    const graph = emptyState();
    expect(resolverFor(graph)).not.toBe(resolverFor({ ...graph }));
  });

  it('returns the same tint map for the same networks array', () => {
    const networks = [makeNetwork(makeProject().id)];
    expect(networkTintsFor(networks)).toBe(networkTintsFor(networks));
    expect(networkTintsFor([...networks])).not.toBe(networkTintsFor(networks));
  });
});
