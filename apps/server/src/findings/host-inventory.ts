import type { DeviceStateHost } from '@netplan/import-contract';
import {
  hostSecurityInventorySchema,
  type DeviceId,
  type EvidenceId,
  type HostSecurityInventory,
  type InputClass,
  type PersistenceEntry,
} from '@netplan/domain';

/**
 * Build a per-Device security inventory (the M5/M6 analysis input) from a
 * device-state host report (ADR-0018). This is the security counterpart to the
 * observation adapter: the adapter maps topology fields to Observations, this
 * maps the Phase-3 security fields to the neutral inventory the findings engine
 * reads. The caller supplies the committed `deviceId` (resolved from the host's
 * stable id) and the source `evidenceId` for traceability.
 */
export function hostInventoryFromReport(
  host: DeviceStateHost,
  deviceId: DeviceId,
  evidenceId: EvidenceId | null,
): HostSecurityInventory {
  const persistence: PersistenceEntry[] = [
    ...(host.startupEntries ?? []).map((e) => ({
      kind: 'startup' as const,
      name: e.name,
      command: e.command ?? '',
      path: e.path ?? null,
    })),
    ...(host.scheduledTasks ?? []).map((e) => ({
      kind: 'scheduledTask' as const,
      name: e.name,
      command: e.command ?? '',
      path: e.path ?? null,
    })),
    ...(host.services ?? []).map((e) => ({
      kind: 'service' as const,
      name: e.name,
      command: e.binaryPath ?? '',
      path: e.binaryPath ?? null,
    })),
    ...(host.persistence ?? []).map((e) => ({
      kind: 'other' as const,
      name: e.name,
      command: e.command ?? '',
      path: e.path ?? null,
    })),
  ];

  const software = [
    ...(host.packages ?? []).map((p) => ({
      name: p.name,
      publisher: p.publisher ?? '',
      version: p.version ?? '',
      remoteAccess: false,
    })),
    ...(host.remoteAccess ?? []).map((p) => ({
      name: p.name,
      publisher: p.publisher ?? '',
      version: p.version ?? '',
      remoteAccess: true,
    })),
  ];

  // Coverage reflects which classes the collector actually reported (present,
  // even if empty), so M9 can distinguish "collected, none found" from "not collected".
  const collectedClasses: InputClass[] = [];
  if (host.listeningPorts.length >= 0) collectedClasses.push('listeningServices');
  if (host.processes !== undefined) collectedClasses.push('processes');
  if (
    host.persistence !== undefined ||
    host.startupEntries !== undefined ||
    host.scheduledTasks !== undefined ||
    host.services !== undefined
  ) {
    collectedClasses.push('persistence');
  }
  if (host.packages !== undefined) collectedClasses.push('installedSoftware');
  if (host.remoteAccess !== undefined) collectedClasses.push('remoteAccess');
  if (host.fileInventory !== undefined) collectedClasses.push('fileInventory');

  return hostSecurityInventorySchema.parse({
    deviceId,
    evidenceId,
    files: (host.fileInventory ?? []).map((f) => ({ path: f.path, sha256: f.sha256 ?? null })),
    processes: (host.processes ?? []).map((p) => ({ name: p.name, path: p.path ?? null })),
    persistence,
    software,
    collectedClasses,
  });
}
