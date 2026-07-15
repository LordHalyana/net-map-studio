import { eq } from 'drizzle-orm';
import {
  computeDeviceCoverage,
  deviceIdSchema,
  evidenceIdSchema,
  inventoryCoverage,
  observationSchema,
  reconcileFindings,
  runBuiltInAnalysis,
  DEFAULT_ENGINE_CONFIG,
  type DeviceCoverage,
  type FindingView,
  type HostSecurityInventory,
  type InputClass,
} from '@netplan/domain';
import { deviceStateReportSchema } from '@netplan/import-contract';
import type { Db } from '../db/index.js';
import { observations as observationsTable } from '../db/schema.js';
import type { Engine } from '../engine/store.js';
import type { ImportStore } from '../imports/store.js';
import type { ProvenanceStore } from '../imports/provenance.js';
import { hostInventoryFromReport } from './host-inventory.js';

const DEVICE_STATE_PARSER = 'device-state';

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
  db: Db,
  engine: Engine,
  importStore: ImportStore,
  provenanceStore: ProvenanceStore,
) {
  /**
   * Map each device-state host's stable id to its committed Device id, via the
   * provenance sidecar: a device's provenance row carries the observation it
   * came from, and that observation's device hints carry the stable id.
   */
  function stableIdToDeviceId(projectId: string): Map<string, string> {
    const observationRows = db
      .select()
      .from(observationsTable)
      .where(eq(observationsTable.projectId, projectId))
      .all()
      .map((r) => observationSchema.parse(r));
    const observationById = new Map(observationRows.map((o) => [o.id, o] as const));

    const map = new Map<string, string>();
    for (const row of provenanceStore.listForProject(projectId)) {
      if (row.entityType !== 'device' || !row.observationId) continue;
      const observation = observationById.get(row.observationId);
      if (observation?.claim.targetKind === 'device' && observation.claim.device.stableId) {
        map.set(observation.claim.device.stableId, row.entityId);
      }
    }
    return map;
  }

  /** Build one host-security inventory per committed Device from device-state evidence. */
  function buildInventories(projectId: string): HostSecurityInventory[] {
    const stableToDevice = stableIdToDeviceId(projectId);
    const inventories: HostSecurityInventory[] = [];
    for (const record of importStore.listEvidence(projectId)) {
      if (record.parserName !== DEVICE_STATE_PARSER) continue;
      const blob = importStore.getEvidenceBlob(projectId, record.id);
      if (!blob) continue; // hash-only retention — no raw bytes to parse
      const raw =
        blob.encoding === 'base64'
          ? Buffer.from(blob.content, 'base64').toString('utf8')
          : blob.content;
      const parsed = deviceStateReportSchema.safeParse(safeJson(raw));
      if (!parsed.success) continue;
      for (const host of parsed.data.hosts) {
        const deviceId = stableToDevice.get(host.deviceId);
        if (!deviceId) continue; // host not reconciled to a committed Device — skip, never fabricate
        inventories.push(
          hostInventoryFromReport(
            host,
            deviceIdSchema.parse(deviceId),
            evidenceIdSchema.parse(record.id),
          ),
        );
      }
    }
    return inventories;
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

  function analyze(projectId: string): FindingsReport {
    const state = engine.getState(projectId);
    const provenance = provenanceStore.listForProject(projectId);
    const inventories = buildInventories(projectId);
    const log = engine.getLog(projectId);
    const opSeq = log.length > 0 ? (log[log.length - 1]?.seq ?? 0) : 0;

    const run = runBuiltInAnalysis({
      state,
      provenance,
      evidence: [],
      hostInventories: inventories,
      config: DEFAULT_ENGINE_CONFIG,
      opSeq,
    });

    return {
      findings: reconcileFindings(run.detections, state.findingDispositions),
      coverage: coverageFor(projectId, inventories),
      opSeq: run.opSeq,
      configHash: run.configHash,
    };
  }

  return { analyze, buildInventories };
}

export type FindingsService = ReturnType<typeof createFindingsService>;

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function dedupeClasses(classes: InputClass[]): InputClass[] {
  return [...new Set(classes)];
}
