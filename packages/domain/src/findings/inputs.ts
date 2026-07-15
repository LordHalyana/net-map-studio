import { z } from 'zod';
import { deviceIdSchema } from '../ids.js';
import { evidenceIdSchema } from '../imports.js';
import { inputClassSchema, type InputClass } from './coverage.js';

/**
 * Per-Device security telemetry (ADR-0018 Phase-3 fields): the neutral analysis
 * input the filename/path (M5) and process/persistence (M6) families consume.
 *
 * This is *analysis input*, not a canvas entity — a Device has processes and
 * files, but they are security signal, not topology, so they never become
 * Observations/entities. The server builds one inventory per Device from the
 * most recent device-state Evidence; detection reads them from the RuleContext.
 */

export const fileArtifactSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().nullable().default(null),
});
export type FileArtifact = z.infer<typeof fileArtifactSchema>;

export const processInfoSchema = z.object({
  name: z.string().min(1),
  /** The executable's on-disk path, when the collector reported it. */
  path: z.string().nullable().default(null),
});
export type ProcessInfo = z.infer<typeof processInfoSchema>;

export const persistenceKindSchema = z.enum(['startup', 'scheduledTask', 'service', 'other']);
export type PersistenceKind = z.infer<typeof persistenceKindSchema>;

export const persistenceEntrySchema = z.object({
  kind: persistenceKindSchema,
  name: z.string().min(1),
  /** The command or binary the entry launches. */
  command: z.string().default(''),
  path: z.string().nullable().default(null),
});
export type PersistenceEntry = z.infer<typeof persistenceEntrySchema>;

export const installedSoftwareSchema = z.object({
  name: z.string().min(1),
  publisher: z.string().default(''),
  version: z.string().default(''),
  /** True when the collector tagged this as remote-access / remote-admin software. */
  remoteAccess: z.boolean().default(false),
});
export type InstalledSoftware = z.infer<typeof installedSoftwareSchema>;

export const hostSecurityInventorySchema = z.object({
  deviceId: deviceIdSchema,
  /** The device-state Evidence this inventory was built from, for traceability. */
  evidenceId: evidenceIdSchema.nullable().default(null),
  files: z.array(fileArtifactSchema).default([]),
  processes: z.array(processInfoSchema).default([]),
  persistence: z.array(persistenceEntrySchema).default([]),
  software: z.array(installedSoftwareSchema).default([]),
  /** Which input classes this inventory actually carries (feeds coverage, M9). */
  collectedClasses: z.array(inputClassSchema).default([]),
});
export type HostSecurityInventory = z.infer<typeof hostSecurityInventorySchema>;

/** The input classes a non-empty inventory can contribute to coverage (M9). */
export function inventoryCoverage(inventory: HostSecurityInventory): InputClass[] {
  const classes = new Set<InputClass>(inventory.collectedClasses);
  if (inventory.processes.length > 0) classes.add('processes');
  if (inventory.persistence.length > 0) classes.add('persistence');
  if (inventory.software.length > 0) classes.add('installedSoftware');
  if (inventory.files.length > 0) classes.add('fileInventory');
  if (inventory.software.some((s) => s.remoteAccess)) classes.add('remoteAccess');
  return [...classes];
}
