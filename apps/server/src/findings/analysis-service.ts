import {
  computeDeviceCoverage,
  hostSecurityInventorySchema,
  inventoryCoverage,
  reconcileFindings,
  runBuiltInAnalysis,
  DEFAULT_ENGINE_CONFIG,
  hashConfig,
  type DeviceCoverage,
  type FindingView,
  type HostArtifact,
  type HostSecurityInventory,
  type InputClass,
} from '@netplan/domain';
import type { Db } from '../db/index.js';
import type { Engine } from '../engine/store.js';
import type { ProvenanceStore } from '../imports/provenance.js';
import type { EnrichmentService } from '../egress/enrichment.js';

/** A device's evaluability for the findings UI (M11 coverage surfacing). */
export type DeviceEvaluability = DeviceCoverage;

export interface FindingsReport {
  /** The reconciled findings — detection joined to disposition by fingerprint. */
  findings: FindingView[];
  /** Per-device input coverage (state + host inventory), for coverage surfacing. */
  coverage: DeviceEvaluability[];
  /** The Operation-log position this analysis was computed against. */
  opSeq: number;
  /** The rule config hash in force — reproducibility. */
  configHash: string;
}

export function createFindingsService(
  _db: Db,
  engine: Engine,
  provenanceStore: ProvenanceStore,
  enrichmentService: EnrichmentService,
) {
  /**
   * Build one host-security inventory per Device from the committed
   * hostArtifacts collection (improvements M7, #64). Detection inputs are
   * pipeline-written entities now — analysis no longer re-parses raw evidence
   * blobs, so it keeps working after evidence is downgraded to hashOnly.
   * Evidence refs live in the provenance sidecar, per field, like every other
   * imported value.
   */
  function buildInventories(projectId: string): HostSecurityInventory[] {
    const state = engine.getState(projectId);
    const byDevice = new Map<string, HostArtifact[]>();
    for (const artifact of state.hostArtifacts) {
      const list = byDevice.get(artifact.deviceId) ?? [];
      list.push(artifact);
      byDevice.set(artifact.deviceId, list);
    }
    return [...byDevice.entries()].map(([deviceId, artifacts]) =>
      hostSecurityInventorySchema.parse({
        deviceId,
        evidenceId: null,
        files: artifacts
          .filter((a) => a.kind === 'file')
          .map((a) => ({ path: a.path ?? a.name, sha256: a.sha256 })),
        processes: artifacts
          .filter((a) => a.kind === 'process')
          .map((a) => ({ name: a.name, path: a.path })),
        persistence: artifacts
          .filter((a) => a.kind === 'persistence')
          .map((a) => ({
            kind: a.persistenceKind ?? 'other',
            name: a.name,
            command: a.command,
            path: a.path,
          })),
        software: artifacts
          .filter((a) => a.kind === 'software')
          .map((a) => ({
            name: a.name,
            publisher: a.publisher,
            version: a.version,
            remoteAccess: a.remoteAccess,
          })),
        collectedClasses: [],
      }),
    );
  }

  function coverageFor(
    projectId: string,
    inventories: readonly HostSecurityInventory[],
  ): DeviceEvaluability[] {
    const state = engine.getState(projectId);
    const inventoryByDevice = new Map(inventories.map((i) => [i.deviceId, i] as const));
    return computeDeviceCoverage(state).map((cov) => {
      const inventory = inventoryByDevice.get(cov.deviceId);
      const invClasses = inventory ? inventoryCoverage(inventory) : [];
      const available = dedupeClasses([...cov.available, ...invClasses]);
      const availableSet = new Set(available);
      return {
        deviceId: cov.deviceId,
        deviceName: cov.deviceName,
        available,
        missing: cov.missing.filter((c) => !availableSet.has(c)),
      };
    });
  }

  /**
   * Cache keyed on the operation-log watermark + rule-config hash (improvements
   * M14, #71). Detection is a pure recomputation, so between edits the same
   * (watermark, config) yields the same report — the analysis (a full graph
   * sweep) runs only when either moves. One entry per project.
   */
  const cache = new Map<string, { key: string; report: FindingsReport }>();
  // the rule-config hash (not just its version) — any threshold/list/override
  // change moves it, so the cache invalidates when tuning changes (M14, #71)
  const configHash = hashConfig(DEFAULT_ENGINE_CONFIG);

  function analyze(projectId: string): FindingsReport {
    const opSeq = engine.getWatermark(projectId);
    // Enrichment Evidence (ADR-0028) is collection, not a logged mutation, so
    // it does not move the op-log watermark — fold a cheap signature of the
    // stored enrichments into the key so a re-fetch invalidates the cache.
    const enrichments = enrichmentService.loadEnrichments(projectId);
    const enrichmentSig = `${enrichments.length}:${enrichments
      .map((e) => `${e.evidenceId}@${e.payload.fetchedAt}`)
      .sort()
      .join(',')}`;
    const cacheKey = `${opSeq}:${configHash}:${enrichmentSig}`;
    const cached = cache.get(projectId);
    if (cached && cached.key === cacheKey) return cached.report;

    const state = engine.getState(projectId);
    const provenance = provenanceStore.listForProject(projectId);
    const inventories = buildInventories(projectId);

    const run = runBuiltInAnalysis({
      state,
      provenance,
      evidence: [],
      hostInventories: inventories,
      // Stored enrichment payloads only (ADR-0028) — never a live lookup, so
      // this recomputation stays pure and reproducible.
      enrichments: enrichmentService.loadEnrichments(projectId),
      config: DEFAULT_ENGINE_CONFIG,
      opSeq,
    });

    const report: FindingsReport = {
      findings: reconcileFindings(run.detections, state.findingDispositions),
      coverage: coverageFor(projectId, inventories),
      opSeq: run.opSeq,
      configHash: run.configHash,
    };
    cache.set(projectId, { key: cacheKey, report });
    return report;
  }

  return { analyze, buildInventories };
}

export type FindingsService = ReturnType<typeof createFindingsService>;

function dedupeClasses(classes: InputClass[]): InputClass[] {
  return [...new Set(classes)];
}
