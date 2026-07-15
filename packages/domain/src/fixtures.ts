import {
  addressIdSchema,
  addressSchema,
  baselineIdSchema,
  baselineSchema,
  defaultEgressSettings,
  egressAuditRecordIdSchema,
  egressAuditRecordSchema,
  egressSettingsSchema,
  evidenceIdSchema,
  evidenceSchema,
  fieldProvenanceIdSchema,
  fieldProvenanceSchema,
  findingDispositionSchema,
  findingIdSchema,
  hostSecurityInventorySchema,
  flowIdSchema,
  flowSchema,
  identityIdSchema,
  identitySchema,
  importJobIdSchema,
  importJobSchema,
  observationIdSchema,
  observationSchema,
  roleAssignmentIdSchema,
  roleAssignmentSchema,
  deviceIdSchema,
  deviceSchema,
  interfaceIdSchema,
  interfaceSchema,
  linkIdSchema,
  linkSchema,
  networkIdSchema,
  networkSchema,
  newId,
  policyRuleIdSchema,
  policyRuleSchema,
  projectIdSchema,
  projectSchema,
  serviceIdSchema,
  serviceSchema,
  siteIdSchema,
  siteSchema,
  zoneIdSchema,
  zoneSchema,
  type Address,
  type Baseline,
  type Device,
  type EgressAuditRecord,
  type EgressSettings,
  type Evidence,
  type FieldProvenance,
  type FindingDisposition,
  type Flow,
  type HostSecurityInventory,
  type DeviceId,
  type Identity,
  type ImportJob,
  type Observation,
  type RoleAssignment,
  type Interface,
  type Link,
  type Network,
  type PolicyRule,
  type Project,
  type ProjectId,
  type Service,
  type Site,
  type Zone,
} from './index.js';

/** Parse-based fixtures: defaults are filled by the schemas themselves. */

export function makeProject(overrides: Partial<Project> = {}): Project {
  return projectSchema.parse({
    id: newId(projectIdSchema),
    name: 'Test Project',
    createdAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  });
}

export function makeSite(projectId: ProjectId, overrides: Partial<Site> = {}): Site {
  return siteSchema.parse({
    id: newId(siteIdSchema),
    projectId,
    name: 'HQ',
    ...overrides,
  });
}

export function makeZone(site: Site, overrides: Partial<Zone> = {}): Zone {
  return zoneSchema.parse({
    id: newId(zoneIdSchema),
    projectId: site.projectId,
    siteId: site.id,
    name: 'Server Room',
    ...overrides,
  });
}

export function makeDevice(projectId: ProjectId, overrides: Partial<Device> = {}): Device {
  return deviceSchema.parse({
    id: newId(deviceIdSchema),
    projectId,
    name: 'core-router',
    deviceType: 'router',
    ...overrides,
  });
}

export function makeInterface(device: Device, overrides: Partial<Interface> = {}): Interface {
  return interfaceSchema.parse({
    id: newId(interfaceIdSchema),
    projectId: device.projectId,
    deviceId: device.id,
    name: 'eth0',
    ...overrides,
  });
}

export function makeAddress(iface: Interface, overrides: Partial<Address> = {}): Address {
  return addressSchema.parse({
    id: newId(addressIdSchema),
    projectId: iface.projectId,
    interfaceId: iface.id,
    kind: 'ipv4',
    value: '10.0.0.1',
    ...overrides,
  });
}

export function makeNetwork(projectId: ProjectId, overrides: Partial<Network> = {}): Network {
  return networkSchema.parse({
    id: newId(networkIdSchema),
    projectId,
    name: 'Staff VLAN',
    kind: 'vlan',
    vlanId: 10,
    ...overrides,
  });
}

export function makeLink(a: Interface, b: Interface, overrides: Partial<Link> = {}): Link {
  return linkSchema.parse({
    id: newId(linkIdSchema),
    projectId: a.projectId,
    source: { kind: 'interface', id: a.id },
    target: { kind: 'interface', id: b.id },
    ...overrides,
  });
}

export function makeService(projectId: ProjectId, overrides: Partial<Service> = {}): Service {
  return serviceSchema.parse({
    id: newId(serviceIdSchema),
    projectId,
    name: 'HTTPS',
    protocol: 'tcp',
    portStart: 443,
    portEnd: 443,
    ...overrides,
  });
}

export function makeImportJob(projectId: ProjectId, overrides: Partial<ImportJob> = {}): ImportJob {
  return importJobSchema.parse({
    id: newId(importJobIdSchema),
    projectId,
    status: 'review',
    parserName: 'fixture',
    parserVersion: '1',
    schemaVersion: '1',
    changeSetId: null,
    startedAt: '2026-07-15T00:00:00.000Z',
    finishedAt: null,
    error: null,
    ...overrides,
  });
}

export function makeEvidence(job: ImportJob, overrides: Partial<Evidence> = {}): Evidence {
  return evidenceSchema.parse({
    id: newId(evidenceIdSchema),
    projectId: job.projectId,
    importJobId: job.id,
    filename: 'scan.json',
    sha256: 'a'.repeat(64),
    sizeBytes: 128,
    contentClass: 'structured',
    retention: 'inline',
    chunkRef: null,
    parserName: job.parserName,
    parserVersion: job.parserVersion,
    collectedAt: null,
    importedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  });
}

export function makeObservation(
  evidence: Evidence,
  overrides: Partial<Observation> = {},
): Observation {
  return observationSchema.parse({
    id: newId(observationIdSchema),
    projectId: evidence.projectId,
    importJobId: evidence.importJobId,
    evidenceId: evidence.id,
    contributor: 'exactMacMatch',
    observedAt: '2026-07-15T00:00:00.000Z',
    claim: {
      targetKind: 'device',
      device: { mac: 'aa:bb:cc:dd:ee:ff', hostname: 'web01' },
      fields: { name: 'web01', os: 'Ubuntu 24.04' },
    },
    ...overrides,
  });
}

export function makeFlow(projectId: ProjectId, overrides: Partial<Flow> = {}): Flow {
  return flowSchema.parse({
    id: newId(flowIdSchema),
    projectId,
    source: { kind: 'external', value: '203.0.113.7' },
    destination: { kind: 'external', value: '10.0.0.10' },
    protocol: 'tcp',
    port: 443,
    firstSeen: '2026-07-14T00:00:00.000Z',
    lastSeen: '2026-07-15T00:00:00.000Z',
    observationCount: 3,
    confidence: 0.3,
    lifecycleState: 'observed',
    ...overrides,
  });
}

export function makeIdentity(projectId: ProjectId, overrides: Partial<Identity> = {}): Identity {
  return identitySchema.parse({
    id: newId(identityIdSchema),
    projectId,
    scope: 'local',
    name: 'alice',
    lifecycleState: 'observed',
    ...overrides,
  });
}

export function makeRoleAssignment(
  identity: Identity,
  overrides: Partial<RoleAssignment> = {},
): RoleAssignment {
  return roleAssignmentSchema.parse({
    id: newId(roleAssignmentIdSchema),
    projectId: identity.projectId,
    identityId: identity.id,
    privilege: 'localAdministrator',
    lifecycleState: 'observed',
    ...overrides,
  });
}

export function makeFieldProvenance(
  observation: Observation,
  overrides: Partial<FieldProvenance> = {},
): FieldProvenance {
  return fieldProvenanceSchema.parse({
    id: newId(fieldProvenanceIdSchema),
    projectId: observation.projectId,
    entityType: 'device',
    entityId: newId(deviceIdSchema),
    field: 'name',
    sourceType: 'imported',
    evidenceId: observation.evidenceId,
    importJobId: observation.importJobId,
    observationId: observation.id,
    confidence: 0.85,
    parserVersion: '1.0.0',
    status: 'accepted',
    observedValue: 'web01',
    observedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  });
}

export function makePolicyRule(
  source: Network,
  destination: Network,
  overrides: Partial<PolicyRule> = {},
): PolicyRule {
  return policyRuleSchema.parse({
    id: newId(policyRuleIdSchema),
    projectId: source.projectId,
    source: { kind: 'network', id: source.id },
    destination: { kind: 'network', id: destination.id },
    action: 'allow',
    ...overrides,
  });
}

export function makeHostInventory(
  deviceId: DeviceId,
  overrides: Partial<HostSecurityInventory> = {},
): HostSecurityInventory {
  return hostSecurityInventorySchema.parse({
    deviceId,
    files: [],
    processes: [],
    persistence: [],
    software: [],
    ...overrides,
  });
}

export function makeBaseline(
  projectId: ProjectId,
  scope: Baseline['scope'],
  overrides: Partial<Baseline> = {},
): Baseline {
  return baselineSchema.parse({
    id: newId(baselineIdSchema),
    projectId,
    name: 'Expected services',
    scope,
    lifecycleState: 'manuallyVerified',
    ...overrides,
  });
}

export function makeFindingDisposition(
  projectId: ProjectId,
  overrides: Partial<FindingDisposition> = {},
): FindingDisposition {
  return findingDispositionSchema.parse({
    id: newId(findingIdSchema),
    projectId,
    fingerprint: 'fixture-fingerprint',
    status: 'new',
    notes: '',
    ...overrides,
  });
}

export function makeEgressSettings(
  projectId: ProjectId,
  overrides: Partial<EgressSettings> = {},
): EgressSettings {
  return egressSettingsSchema.parse({
    ...defaultEgressSettings(projectId, '2026-07-15T00:00:00.000Z'),
    ...overrides,
  });
}

export function makeEgressAuditRecord(
  projectId: ProjectId,
  overrides: Partial<EgressAuditRecord> = {},
): EgressAuditRecord {
  return egressAuditRecordSchema.parse({
    id: newId(egressAuditRecordIdSchema),
    projectId,
    timestamp: '2026-07-15T00:00:00.000Z',
    providerId: 'stub',
    indicatorType: 'fileHash',
    query: 'a'.repeat(64),
    outcome: 'success',
    ...overrides,
  });
}
