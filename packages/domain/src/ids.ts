import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/**
 * Every entity primary key is a UUIDv7 (ADR-0015): globally unique so identity
 * survives export/re-import and merges, time-ordered for index locality, and
 * mintable on client or server.
 */
export const projectIdSchema = z.uuidv7().brand<'ProjectId'>();
export const siteIdSchema = z.uuidv7().brand<'SiteId'>();
export const zoneIdSchema = z.uuidv7().brand<'ZoneId'>();
export const deviceIdSchema = z.uuidv7().brand<'DeviceId'>();
export const interfaceIdSchema = z.uuidv7().brand<'InterfaceId'>();
export const addressIdSchema = z.uuidv7().brand<'AddressId'>();
export const networkIdSchema = z.uuidv7().brand<'NetworkId'>();
export const linkIdSchema = z.uuidv7().brand<'LinkId'>();
export const serviceIdSchema = z.uuidv7().brand<'ServiceId'>();
export const policyRuleIdSchema = z.uuidv7().brand<'PolicyRuleId'>();
export const operationIdSchema = z.uuidv7().brand<'OperationId'>();
export const changeSetIdSchema = z.uuidv7().brand<'ChangeSetId'>();
export const flowIdSchema = z.uuidv7().brand<'FlowId'>();
export const identityIdSchema = z.uuidv7().brand<'IdentityId'>();
export const roleAssignmentIdSchema = z.uuidv7().brand<'RoleAssignmentId'>();
/** Host security artifacts (improvements M7, #64): detection inputs per Device. */
export const hostArtifactIdSchema = z.uuidv7().brand<'HostArtifactId'>();
/** Phase-3 findings (ADR-0023): the persisted disposition's primary key. */
export const findingIdSchema = z.uuidv7().brand<'FindingId'>();
/** Phase-3 Baseline (ADR-0025): the expected-state yardstick's primary key. */
export const baselineIdSchema = z.uuidv7().brand<'BaselineId'>();

export type ProjectId = z.infer<typeof projectIdSchema>;
export type SiteId = z.infer<typeof siteIdSchema>;
export type ZoneId = z.infer<typeof zoneIdSchema>;
export type DeviceId = z.infer<typeof deviceIdSchema>;
export type InterfaceId = z.infer<typeof interfaceIdSchema>;
export type AddressId = z.infer<typeof addressIdSchema>;
export type NetworkId = z.infer<typeof networkIdSchema>;
export type LinkId = z.infer<typeof linkIdSchema>;
export type ServiceId = z.infer<typeof serviceIdSchema>;
export type PolicyRuleId = z.infer<typeof policyRuleIdSchema>;
export type OperationId = z.infer<typeof operationIdSchema>;
export type ChangeSetId = z.infer<typeof changeSetIdSchema>;
export type FlowId = z.infer<typeof flowIdSchema>;
export type HostArtifactId = z.infer<typeof hostArtifactIdSchema>;
export type IdentityId = z.infer<typeof identityIdSchema>;
export type RoleAssignmentId = z.infer<typeof roleAssignmentIdSchema>;
export type FindingId = z.infer<typeof findingIdSchema>;
export type BaselineId = z.infer<typeof baselineIdSchema>;

/** Mint a new UUIDv7 for the given branded id schema: `newId(deviceIdSchema)`. */
export function newId<S extends z.ZodType<string>>(schema: S): z.output<S> {
  return schema.parse(uuidv7());
}
