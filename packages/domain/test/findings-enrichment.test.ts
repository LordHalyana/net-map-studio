import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_CONFIG,
  enrichmentPayloadSchema,
  isEnrichmentStale,
  newId,
  parseEnrichmentEvidence,
  evidenceIdSchema,
  runBuiltInAnalysis,
  type AnalysisContext,
  type EnrichmentInput,
  type EnrichmentPayload,
  type ProjectState,
} from '../src/index.js';
import { makeDevice, makeFlow, makeHostInventory, makeProject } from '../src/fixtures.js';

/**
 * P4-M2 DoD (ADR-0028): rules consume stored enrichment Evidence
 * deterministically — identical stored enrichment ⇒ identical findings; no
 * live call, no clock read. Staleness is a presentation-time computation.
 */

const HASH = 'ab'.repeat(32);
const FETCHED_AT = '2026-07-15T00:00:00.000Z';

function payload(overrides: Partial<EnrichmentPayload> = {}): EnrichmentPayload {
  return enrichmentPayloadSchema.parse({
    kind: 'threatIntelEnrichment',
    providerId: 'local-feed',
    indicatorType: 'fileHash',
    query: HASH,
    rawResponse: '{"verdict":"malicious"}',
    response: { verdict: 'malicious', score: 0.95, detail: 'known ransomware loader' },
    fetchedAt: FETCHED_AT,
    ttlSeconds: 3600,
    ...overrides,
  });
}

function enrichment(overrides: Partial<EnrichmentPayload> = {}): EnrichmentInput {
  return { evidenceId: newId(evidenceIdSchema), payload: payload(overrides) };
}

function emptyState(project = makeProject()): ProjectState {
  return {
    project,
    sites: [],
    zones: [],
    devices: [],
    interfaces: [],
    addresses: [],
    networks: [],
    links: [],
    services: [],
    policyRules: [],
    flows: [],
    hostArtifacts: [],
    reports: [],
    importProfiles: [],
    identities: [],
    roleAssignments: [],
    baselines: [],
    findingDispositions: [],
  };
}

function contextWith(
  state: ProjectState,
  enrichments: EnrichmentInput[],
  hostInventories: AnalysisContext['hostInventories'] = [],
): AnalysisContext {
  return {
    state,
    provenance: [],
    evidence: [],
    hostInventories,
    enrichments,
    config: DEFAULT_ENGINE_CONFIG,
    opSeq: 1,
  };
}

describe('enrichment staleness (presentation-time, never detection input)', () => {
  it('is fresh within TTL and stale past it', () => {
    const p = payload({ ttlSeconds: 3600 });
    expect(isEnrichmentStale(p, '2026-07-15T00:59:59.000Z')).toBe(false);
    expect(isEnrichmentStale(p, '2026-07-15T01:00:01.000Z')).toBe(true);
  });

  it('round-trips through a stored Evidence blob', () => {
    const id = newId(evidenceIdSchema);
    const parsed = parseEnrichmentEvidence(id, JSON.stringify(payload()));
    expect(parsed?.payload.query).toBe(HASH);
    expect(parseEnrichmentEvidence(id, 'not json')).toBeNull();
    expect(parseEnrichmentEvidence(id, '{"kind":"something-else"}')).toBeNull();
  });
});

describe('enrichment.fileHashMatch', () => {
  function fileMatchContext(verdict: 'malicious' | 'suspicious' | 'benign' | 'unknown') {
    const project = makeProject();
    const device = makeDevice(project.id);
    const state = { ...emptyState(project), devices: [device] };
    const inventory = makeHostInventory(device.id, {
      files: [{ path: 'C:\\Windows\\Temp\\loader.exe', sha256: HASH }],
    });
    const e = enrichment({ response: { verdict, score: null, detail: '' } });
    return { ctx: contextWith(state, [e], [inventory]), enrichmentInput: e, device };
  }

  it('a malicious hash enrichment matching an inventory file emits a critical finding citing the enrichment Evidence', () => {
    const { ctx, enrichmentInput } = fileMatchContext('malicious');
    const run = runBuiltInAnalysis(ctx);
    const matches = run.detections.filter((d) => d.ruleId === 'enrichment.fileHashMatch');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe('critical');
    expect(matches[0]?.evidenceRefs).toContain(enrichmentInput.evidenceId);
    expect(matches[0]?.explanation).toContain('Enriched by local-feed at');
  });

  it('a suspicious verdict lands as high severity; benign and unknown emit nothing', () => {
    expect(
      runBuiltInAnalysis(fileMatchContext('suspicious').ctx).detections.find(
        (d) => d.ruleId === 'enrichment.fileHashMatch',
      )?.severity,
    ).toBe('high');
    for (const verdict of ['benign', 'unknown'] as const) {
      const { ctx } = fileMatchContext(verdict);
      expect(
        runBuiltInAnalysis(ctx).detections.filter((d) => d.ruleId === 'enrichment.fileHashMatch'),
      ).toHaveLength(0);
    }
  });

  it('re-running analysis over unchanged enrichment Evidence yields identical findings (I2)', () => {
    const { ctx } = fileMatchContext('malicious');
    const first = runBuiltInAnalysis(ctx);
    const second = runBuiltInAnalysis(ctx);
    expect(second.detections).toEqual(first.detections);
  });
});

describe('enrichment.indicatorDestination', () => {
  it('a malicious ip enrichment matching a Flow external destination emits a finding on the source device', () => {
    const project = makeProject();
    const device = makeDevice(project.id);
    const flow = makeFlow(project.id, {
      source: { kind: 'device', id: device.id },
      destination: { kind: 'external', value: '203.0.113.7' },
      confidence: 0.8,
    });
    const state = { ...emptyState(project), devices: [device], flows: [flow] };
    const e = enrichment({
      indicatorType: 'ip',
      query: '203.0.113.7',
      response: { verdict: 'malicious', score: 1, detail: 'C2 sinkhole list' },
    });

    const run = runBuiltInAnalysis(contextWith(state, [e]));
    const matches = run.detections.filter((d) => d.ruleId === 'enrichment.indicatorDestination');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.affected).toEqual({ kind: 'device', id: device.id });
    expect(matches[0]?.evidenceRefs).toEqual([e.evidenceId]);
    expect(matches[0]?.confidence).toBeCloseTo(0.8);
  });

  it('a domain enrichment matches hostname destinations case-insensitively', () => {
    const project = makeProject();
    const device = makeDevice(project.id);
    const flow = makeFlow(project.id, {
      source: { kind: 'device', id: device.id },
      destination: { kind: 'external', value: 'Evil.Example.COM' },
    });
    const state = { ...emptyState(project), devices: [device], flows: [flow] };
    const e = enrichment({
      indicatorType: 'domain',
      query: 'evil.example.com',
      response: { verdict: 'suspicious', score: null, detail: '' },
    });

    const run = runBuiltInAnalysis(contextWith(state, [e]));
    const match = run.detections.find((d) => d.ruleId === 'enrichment.indicatorDestination');
    expect(match).toBeDefined();
    expect(match?.severity).toBe('high');
  });

  it('an enrichment with no matching flow or file emits nothing', () => {
    const run = runBuiltInAnalysis(
      contextWith(emptyState(), [enrichment({ indicatorType: 'ip', query: '198.51.100.9' })]),
    );
    expect(run.detections.filter((d) => d.ruleId.startsWith('enrichment.'))).toHaveLength(0);
  });
});
