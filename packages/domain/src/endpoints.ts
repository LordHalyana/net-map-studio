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
const interfaceEndpoint = z.object({ kind: z.literal('interface'), id: interfaceIdSchema });
const deviceEndpoint = z.object({ kind: z.literal('device'), id: deviceIdSchema });
const networkEndpoint = z.object({ kind: z.literal('network'), id: networkIdSchema });
const zoneEndpoint = z.object({ kind: z.literal('zone'), id: zoneIdSchema });
const subnetEndpoint = z.object({ kind: z.literal('subnet'), id: networkIdSchema });

export const endpointSchema = z.discriminatedUnion('kind', [
  interfaceEndpoint,
  deviceEndpoint,
  networkEndpoint,
  zoneEndpoint,
  subnetEndpoint,
]);
export type Endpoint = z.infer<typeof endpointSchema>;

/**
 * A Flow endpoint (ADR-0019/0020): entity reference when the endpoint is a
 * known object, or an `external` address literal when it is not — an observed
 * communication must never invent a Device for an unknown peer.
 */
export const flowEndpointSchema = z.discriminatedUnion('kind', [
  interfaceEndpoint,
  deviceEndpoint,
  networkEndpoint,
  zoneEndpoint,
  subnetEndpoint,
  z.object({ kind: z.literal('external'), value: z.string().min(1) }),
]);
export type FlowEndpoint = z.infer<typeof flowEndpointSchema>;

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
