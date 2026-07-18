import { z } from 'zod';
import { deviceIdSchema } from '../ids.js';
import type { HostArtifactKind } from '../entities.js';
import type { ProjectState } from '../state.js';

/**
 * The classes of input a rule family needs. Coverage tracking (plan M2/M9)
 * records which classes were available per Device this run, so the
 * collection-quality rule (M9) can flag a rule family as **not-evaluated**
 * rather than silently **passed** when its input is missing, and the UI (M11)
 * can surface per-device evaluability.
 */
export const inputClassSchema = z.enum([
  'listeningServices',
  'processes',
  'persistence',
  'installedSoftware',
  'remoteAccess',
  'fileInventory',
  'flows',
  'identities',
  'roleAssignments',
]);
export type InputClass = z.infer<typeof inputClassSchema>;

export const ALL_INPUT_CLASSES: readonly InputClass[] = inputClassSchema.options;

/**
 * The one artifact-kind → InputClass classifier (#110 B3), shared by graph
 * coverage (committed hostArtifacts) and inventory coverage
 * (`inventoryCoverage` in inputs.ts) so a new class cannot be added to one
 * side only. `remoteAccess` is a flag on software/artifacts, not a kind —
 * both consumers add it from their own flag.
 */
export const HOST_ARTIFACT_INPUT_CLASS: Record<HostArtifactKind, InputClass> = {
  process: 'processes',
  persistence: 'persistence',
  software: 'installedSoftware',
  file: 'fileInventory',
};

export const deviceCoverageSchema = z.object({
  deviceId: deviceIdSchema,
  deviceName: z.string(),
  available: z.array(inputClassSchema),
  missing: z.array(inputClassSchema),
});
export type DeviceCoverage = z.infer<typeof deviceCoverageSchema>;

/**
 * Derive per-Device coverage from the committed graph. A class counts as
 * available when the graph holds evidence-derived entities of that class for
 * the Device. The process / persistence / installed-software / file-inventory
 * classes read from the committed hostArtifacts collection (improvements M7,
 * #64) — the pipeline-written detection inputs of design §3.8.
 */
export function computeDeviceCoverage(state: ProjectState): DeviceCoverage[] {
  const serviceDeviceIds = new Set(
    state.services.map((s) => s.deviceId).filter((id): id is NonNullable<typeof id> => id != null),
  );
  const flowDeviceIds = new Set<string>();
  for (const flow of state.flows) {
    for (const endpoint of [flow.source, flow.destination]) {
      if (endpoint.kind === 'device') flowDeviceIds.add(endpoint.id);
    }
  }
  const identityDeviceIds = new Set(
    state.identities
      .map((i) => i.deviceId)
      .filter((id): id is NonNullable<typeof id> => id != null),
  );
  const roleDeviceIds = new Set(
    state.roleAssignments
      .map((r) => r.deviceId)
      .filter((id): id is NonNullable<typeof id> => id != null),
  );
  const artifactClasses = new Map<string, Set<InputClass>>();
  for (const artifact of state.hostArtifacts) {
    const classes = artifactClasses.get(artifact.deviceId) ?? new Set<InputClass>();
    classes.add(HOST_ARTIFACT_INPUT_CLASS[artifact.kind]);
    if (artifact.remoteAccess) classes.add('remoteAccess');
    artifactClasses.set(artifact.deviceId, classes);
  }

  return state.devices.map((device) => {
    const present = new Set<InputClass>();
    if (serviceDeviceIds.has(device.id)) present.add('listeningServices');
    if (flowDeviceIds.has(device.id)) present.add('flows');
    if (identityDeviceIds.has(device.id)) present.add('identities');
    if (roleDeviceIds.has(device.id)) present.add('roleAssignments');
    for (const cls of artifactClasses.get(device.id) ?? []) present.add(cls);

    return {
      deviceId: device.id,
      deviceName: device.name,
      available: ALL_INPUT_CLASSES.filter((c) => present.has(c)),
      missing: ALL_INPUT_CLASSES.filter((c) => !present.has(c)),
    };
  });
}
