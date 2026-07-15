import { z } from 'zod';
import {
  changeSetIdSchema,
  deviceIdSchema,
  interfaceIdSchema,
  linkIdSchema,
  networkIdSchema,
  operationIdSchema,
  policyRuleIdSchema,
  projectIdSchema,
  zoneIdSchema,
} from './ids.js';
import {
  addressSchema,
  baselineSchema,
  deviceSchema,
  flowSchema,
  identitySchema,
  interfaceSchema,
  linkSchema,
  networkSchema,
  policyRuleSchema,
  roleAssignmentSchema,
  serviceSchema,
  siteSchema,
  zoneSchema,
} from './entities.js';
import { findingStatusSchema } from './findings/disposition.js';

/**
 * The Operation is the atom of the mutation spine (ADR-0010): a serializable,
 * invertible unit of change. Every mutation to the model is expressed as one.
 * Each variant carries enough data that its inverse is computable from the
 * Operation alone — `invert` is a pure function (see `invert.ts`).
 */

const opBase = {
  id: operationIdSchema,
  projectId: projectIdSchema,
};

/** Entities created/deleted generically. Links and PolicyRules have dedicated operations. */
export const entityPayloadSchema = z.discriminatedUnion('entityType', [
  z.object({ entityType: z.literal('site'), entity: siteSchema }),
  z.object({ entityType: z.literal('zone'), entity: zoneSchema }),
  z.object({ entityType: z.literal('device'), entity: deviceSchema }),
  z.object({ entityType: z.literal('interface'), entity: interfaceSchema }),
  z.object({ entityType: z.literal('address'), entity: addressSchema }),
  z.object({ entityType: z.literal('network'), entity: networkSchema }),
  z.object({ entityType: z.literal('service'), entity: serviceSchema }),
  z.object({ entityType: z.literal('flow'), entity: flowSchema }),
  z.object({ entityType: z.literal('identity'), entity: identitySchema }),
  z.object({ entityType: z.literal('roleAssignment'), entity: roleAssignmentSchema }),
  z.object({ entityType: z.literal('baseline'), entity: baselineSchema }),
]);
export type EntityPayload = z.infer<typeof entityPayloadSchema>;
export type GenericEntityType = EntityPayload['entityType'];

/** Every entity type addressable by SetField (connections included). */
export const settableEntityTypeSchema = z.enum([
  'project',
  'site',
  'zone',
  'device',
  'interface',
  'address',
  'network',
  'service',
  'link',
  'policyRule',
  'flow',
  'identity',
  'roleAssignment',
  'baseline',
]);
export type SettableEntityType = z.infer<typeof settableEntityTypeSchema>;

/** Field values travel through the operation log, so they must be JSON. */
export const fieldValueSchema = z.json();
export type FieldValue = z.infer<typeof fieldValueSchema>;

export const createEntityOpSchema = z.object({
  ...opBase,
  kind: z.literal('CreateEntity'),
  payload: entityPayloadSchema,
});

export const deleteEntityOpSchema = z.object({
  ...opBase,
  kind: z.literal('DeleteEntity'),
  /** Full snapshot of the entity being deleted — the data its inverse (CreateEntity) needs. */
  payload: entityPayloadSchema,
});

export const setFieldOpSchema = z.object({
  ...opBase,
  kind: z.literal('SetField'),
  entityType: settableEntityTypeSchema,
  entityId: z.uuidv7(),
  field: z.string().min(1),
  value: fieldValueSchema,
  previousValue: fieldValueSchema,
});

export const createLinkOpSchema = z.object({
  ...opBase,
  kind: z.literal('CreateLink'),
  link: linkSchema,
});

export const deleteLinkOpSchema = z.object({
  ...opBase,
  kind: z.literal('DeleteLink'),
  linkId: linkIdSchema,
  snapshot: linkSchema,
});

export const createPolicyRuleOpSchema = z.object({
  ...opBase,
  kind: z.literal('CreatePolicyRule'),
  rule: policyRuleSchema,
});

export const deletePolicyRuleOpSchema = z.object({
  ...opBase,
  kind: z.literal('DeletePolicyRule'),
  ruleId: policyRuleIdSchema,
  snapshot: policyRuleSchema,
});

/** Membership (ADR-0013): moving an Interface between Networks is one field-level change. */
export const setMembershipOpSchema = z.object({
  ...opBase,
  kind: z.literal('SetMembership'),
  interfaceId: interfaceIdSchema,
  networkId: networkIdSchema.nullable(),
  previousNetworkId: networkIdSchema.nullable(),
});

/** Containment (ADR-0013): re-parenting a Device to another Zone (or none). */
export const setContainmentOpSchema = z.object({
  ...opBase,
  kind: z.literal('SetContainment'),
  deviceId: deviceIdSchema,
  zoneId: zoneIdSchema.nullable(),
  previousZoneId: zoneIdSchema.nullable(),
});

/**
 * Finding disposition (ADR-0023): the analyst workflow is mutated only through
 * the log. Keyed by Fingerprint, not entity id — the disposition row is created
 * on first touch. `previousStatus`/`previousNote` are enriched on apply (like
 * SetField's `previousValue`) so inversion stays a pure function.
 */
export const setFindingStatusOpSchema = z.object({
  ...opBase,
  kind: z.literal('SetFindingStatus'),
  fingerprint: z.string().min(1),
  status: findingStatusSchema,
  previousStatus: findingStatusSchema,
});

export const setFindingNoteOpSchema = z.object({
  ...opBase,
  kind: z.literal('SetFindingNote'),
  fingerprint: z.string().min(1),
  note: z.string(),
  previousNote: z.string(),
});

export const operationSchema = z.discriminatedUnion('kind', [
  createEntityOpSchema,
  deleteEntityOpSchema,
  setFieldOpSchema,
  createLinkOpSchema,
  deleteLinkOpSchema,
  createPolicyRuleOpSchema,
  deletePolicyRuleOpSchema,
  setMembershipOpSchema,
  setContainmentOpSchema,
  setFindingStatusOpSchema,
  setFindingNoteOpSchema,
]);
export type Operation = z.infer<typeof operationSchema>;
export type OperationKind = Operation['kind'];

/** A named group of Operations that applies — and inverts — as one unit. */
export const changeSetSchema = z.object({
  id: changeSetIdSchema,
  projectId: projectIdSchema,
  label: z.string().min(1),
  operations: z.array(operationSchema).min(1),
});
export type ChangeSet = z.infer<typeof changeSetSchema>;
