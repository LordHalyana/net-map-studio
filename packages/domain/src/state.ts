import { z } from 'zod';
import {
  addressSchema,
  baselineSchema,
  deviceSchema,
  flowSchema,
  hostArtifactSchema,
  importProfileSchema,
  reportRecordSchema,
  identitySchema,
  interfaceSchema,
  linkSchema,
  networkSchema,
  policyRuleSchema,
  projectSchema,
  roleAssignmentSchema,
  serviceSchema,
  siteSchema,
  zoneSchema,
} from './entities.js';
import { operationSchema } from './operations.js';
import { findingDispositionSchema } from './findings/disposition.js';

/**
 * A full project graph. Authoritative state lives in the server's entity
 * tables (ADR-0010); this is the wire shape reads return and the client
 * mirrors optimistically.
 */
export const projectStateSchema = z.object({
  project: projectSchema,
  sites: z.array(siteSchema),
  zones: z.array(zoneSchema),
  devices: z.array(deviceSchema),
  interfaces: z.array(interfaceSchema),
  addresses: z.array(addressSchema),
  networks: z.array(networkSchema),
  links: z.array(linkSchema),
  services: z.array(serviceSchema),
  policyRules: z.array(policyRuleSchema),
  /** Phase-2 collections — defaulted so version-1 bundles still parse. */
  flows: z.array(flowSchema).default([]),
  /** Detection inputs per Device (improvements M7, #64) — defaulted for old bundles. */
  hostArtifacts: z.array(hostArtifactSchema).default([]),
  /** Generated-deliverable audit trail (improvements M11, #68). */
  reports: z.array(reportRecordSchema).default([]),
  /** Operator line-format templates (§3.6; improvements M12, #69). */
  importProfiles: z.array(importProfileSchema).default([]),
  identities: z.array(identitySchema).default([]),
  roleAssignments: z.array(roleAssignmentSchema).default([]),
  /** Phase-3 finding dispositions (ADR-0023) — the persisted analyst decisions. */
  findingDispositions: z.array(findingDispositionSchema).default([]),
  /** Phase-3 Baselines (ADR-0025) — the expected-state yardsticks. */
  baselines: z.array(baselineSchema).default([]),
});
export type ProjectState = z.infer<typeof projectStateSchema>;

export const undoRedoAvailabilitySchema = z.object({
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});
export type UndoRedoAvailability = z.infer<typeof undoRedoAvailabilitySchema>;

/** Response of the single mutation surface (and undo/redo). */
export const mutationResponseSchema = z.object({
  appliedOperations: z.array(operationSchema),
  availability: undoRedoAvailabilitySchema,
  state: projectStateSchema,
});
export type MutationResponse = z.infer<typeof mutationResponseSchema>;

/** One row of the append-only operation log (ADR-0010) as served over the wire. */
export const operationLogEntrySchema = z.object({
  seq: z.number().int(),
  id: z.uuidv7(),
  projectId: z.uuidv7(),
  changeSetId: z.uuidv7().nullable(),
  kind: z.string(),
  role: z.enum(['do', 'undo', 'redo']),
  targetUnitId: z.string().nullable(),
  payload: operationSchema,
  createdAt: z.iso.datetime(),
});
export type OperationLogEntry = z.infer<typeof operationLogEntrySchema>;
