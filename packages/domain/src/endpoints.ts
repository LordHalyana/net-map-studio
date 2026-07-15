import { z } from 'zod';
import { deviceIdSchema, interfaceIdSchema, networkIdSchema, zoneIdSchema } from './ids.js';

/**
 * One end of a connection as a polymorphic `(kind, id)` reference (ADR-0012).
 * Referential integrity across the polymorphic reference is validated in the
 * domain layer on the Operation mutation path, not by a DB constraint.
 *
 * A `subnet` endpoint references a Network entity of kind `subnet` — the
 * distinction from `network` is authoring intent (address range vs. named
 * network), both resolve against the Network table.
 */
export const endpointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interface'), id: interfaceIdSchema }),
  z.object({ kind: z.literal('device'), id: deviceIdSchema }),
  z.object({ kind: z.literal('network'), id: networkIdSchema }),
  z.object({ kind: z.literal('zone'), id: zoneIdSchema }),
  z.object({ kind: z.literal('subnet'), id: networkIdSchema }),
]);
export type Endpoint = z.infer<typeof endpointSchema>;

/** A Link terminates on Interfaces only (ADR-0012): port-level fidelity. */
export const linkEndpointSchema = z.object({
  kind: z.literal('interface'),
  id: interfaceIdSchema,
});
export type LinkEndpoint = z.infer<typeof linkEndpointSchema>;

/** PolicyRules (and Phase-2 Flows) may target any endpoint kind. */
export const policyEndpointSchema = endpointSchema;
export type PolicyEndpoint = z.infer<typeof policyEndpointSchema>;

export function isValidLinkEndpoint(endpoint: Endpoint): endpoint is LinkEndpoint {
  return linkEndpointSchema.safeParse(endpoint).success;
}

export function isValidPolicyEndpoint(endpoint: Endpoint): boolean {
  return policyEndpointSchema.safeParse(endpoint).success;
}
