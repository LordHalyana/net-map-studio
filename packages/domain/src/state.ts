import { z } from 'zod';
import {
  addressSchema,
  deviceSchema,
  interfaceSchema,
  linkSchema,
  networkSchema,
  policyRuleSchema,
  projectSchema,
  serviceSchema,
  siteSchema,
  zoneSchema,
} from './entities.js';
import { operationSchema } from './operations.js';

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
