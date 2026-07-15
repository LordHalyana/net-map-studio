import { describe, expect, it } from 'vitest';
import { fromPartial } from '@total-typescript/shoehorn';
import {
  buildCandidates,
  contributorScore,
  observationClaimSchema,
  observationSchema,
  newId,
  evidenceIdSchema,
  importJobIdSchema,
  observationIdSchema,
  projectIdSchema,
  type Observation,
  type ObservationClaim,
} from '../src/index.js';

/**
 * P4-M3: a directory export asserts domain principals without an observing
 * host. Host-less identity claims are valid (domain scope only), flow through
 * dedup keyed on the same natural key hosted claims use, and never fabricate
 * a Device.
 */

const projectId = newId(projectIdSchema);
const importJobId = newId(importJobIdSchema);
const evidenceId = newId(evidenceIdSchema);

function observation(claim: ObservationClaim): Observation {
  return observationSchema.parse({
    id: newId(observationIdSchema),
    projectId,
    importJobId,
    evidenceId,
    contributor: 'directoryExport',
    observedAt: null,
    claim,
  });
}

describe('host-less identity claims (directory export)', () => {
  it('accepts a domain-scoped claim with device: null', () => {
    const result = observationClaimSchema.safeParse({
      targetKind: 'identity',
      device: null,
      identity: { scope: 'domain', name: 'alice', domain: 'CORP' },
      fields: { kind: 'user' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a local-scoped claim without a host — meaningless (ADR-0022)', () => {
    const result = observationClaimSchema.safeParse(
      fromPartial({
        targetKind: 'identity',
        device: null,
        identity: { scope: 'local', name: 'alice', domain: '' },
        fields: {},
      }),
    );
    expect(result.success).toBe(false);
  });

  it('scores a directory export as a strong contributor', () => {
    expect(contributorScore('directoryExport')).toBeGreaterThanOrEqual(0.8);
  });

  it('builds an identity candidate with no device keys and fabricates no Device', () => {
    const candidates = buildCandidates([
      observation({
        targetKind: 'identity',
        device: null,
        identity: { scope: 'domain', name: 'alice', domain: 'CORP' },
        fields: { kind: 'user' },
      }),
    ]);
    expect(candidates.devices).toHaveLength(0);
    expect(candidates.identities).toHaveLength(1);
    expect(candidates.identities[0]?.deviceKeys).toEqual([]);
    expect(candidates.identities[0]?.scope).toBe('domain');
  });

  it('a directory claim and a host-observed claim of the same principal merge into one candidate', () => {
    const candidates = buildCandidates([
      observation({
        targetKind: 'identity',
        device: null,
        identity: { scope: 'domain', name: 'alice', domain: 'corp' },
        fields: { kind: 'user' },
      }),
      observation({
        targetKind: 'identity',
        device: { hostname: 'ws01' },
        identity: { scope: 'domain', name: 'alice', domain: 'CORP' },
        fields: {},
      }),
    ]);
    expect(candidates.identities).toHaveLength(1);
    const identity = candidates.identities[0];
    expect(identity?.observations).toHaveLength(2);
    // the host observation still contributes its device key (M10 correlation input)
    expect(identity?.deviceKeys).toHaveLength(1);
  });

  it('two directory claims of distinct principals stay separate', () => {
    const claims = ['alice', 'bob'].map((name) =>
      observation({
        targetKind: 'identity',
        device: null,
        identity: { scope: 'domain', name, domain: 'CORP' },
        fields: { kind: 'user' },
      }),
    );
    expect(buildCandidates(claims).identities).toHaveLength(2);
  });
});
