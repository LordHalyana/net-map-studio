import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { createSelectSchema } from 'drizzle-zod';
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
} from '@netplan/domain';
import {
  evidenceSchema,
  fieldProvenanceSchema,
  findingDispositionSchema,
  flowSchema,
  identitySchema,
  importJobSchema,
  importProposalSchema,
  observationSchema,
  roleAssignmentSchema,
} from '@netplan/domain';
import {
  makeAddress,
  makeDevice,
  makeEvidence,
  makeFieldProvenance,
  makeFindingDisposition,
  makeFlow,
  makeIdentity,
  makeImportJob,
  makeInterface,
  makeLink,
  makeNetwork,
  makeObservation,
  makePolicyRule,
  makeProject,
  makeRoleAssignment,
  makeService,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';
import {
  entityTables,
  evidence as evidenceTable,
  fieldProvenance as fieldProvenanceTable,
  findingDispositions as findingDispositionsTable,
  importJobs as importJobsTable,
  importProposals as importProposalsTable,
  observations as observationsTable,
} from '../src/db/schema.js';
import { createDb } from '../src/db/index.js';

/**
 * ADR-0017: Zod schemas in packages/domain are the single source of truth.
 * These tests prove the Drizzle tables cannot drift from them.
 */

const project = makeProject();
const site = makeSite(project.id);
const zone = makeZone(site);
const device = makeDevice(project.id, { zoneId: zone.id });
const iface = makeInterface(device);
const address = makeAddress(iface);
const network = makeNetwork(project.id);
const network2 = makeNetwork(project.id, { name: 'Servers VLAN', vlanId: 20 });
const device2 = makeDevice(project.id, { name: 'core-switch', deviceType: 'switch' });
const iface2 = makeInterface(device2, { name: 'ge-0/0/1' });
const link = makeLink(iface, iface2);
const service = makeService(project.id);
const rule = makePolicyRule(network, network2);
const flow = makeFlow(project.id, { serviceId: service.id });
const identity = makeIdentity(project.id, { deviceId: device.id });
const roleAssignment = makeRoleAssignment(identity, { deviceId: device.id });

const cases = [
  ['project', projectSchema, project],
  ['site', siteSchema, site],
  ['zone', zoneSchema, zone],
  ['device', deviceSchema, device],
  ['interface', interfaceSchema, iface],
  ['address', addressSchema, address],
  ['network', networkSchema, network],
  ['link', linkSchema, link],
  ['service', serviceSchema, service],
  ['policyRule', policyRuleSchema, rule],
  ['flow', flowSchema, flow],
  ['identity', identitySchema, identity],
  ['roleAssignment', roleAssignmentSchema, roleAssignment],
] as const;

describe('drizzle tables align with domain Zod schemas', () => {
  it.each(cases)('%s table columns match the schema keys exactly', (entityType, schema) => {
    const columnKeys = Object.keys(getTableColumns(entityTables[entityType])).sort();
    const schemaKeys = Object.keys(schema.shape).sort();
    expect(columnKeys).toEqual(schemaKeys);
  });

  it.each(cases)(
    '%s domain fixture satisfies the drizzle select schema',
    (entityType, _s, fixture) => {
      const selectSchema = createSelectSchema(entityTables[entityType]);
      expect(selectSchema.safeParse(fixture).success).toBe(true);
    },
  );
});

describe('import-spine tables align with domain Zod schemas (ADR-0017, plan M1)', () => {
  const job = makeImportJob(project.id);
  const evidenceFixture = makeEvidence(job);
  const observation = makeObservation(evidenceFixture);

  const provenance = makeFieldProvenance(observation, { entityId: device.id });

  const importCases = [
    ['importJob', importJobsTable, importJobSchema, job],
    ['evidence', evidenceTable, evidenceSchema, evidenceFixture],
    ['observation', observationsTable, observationSchema, observation],
    ['fieldProvenance', fieldProvenanceTable, fieldProvenanceSchema, provenance],
  ] as const;

  it.each(importCases)('%s table columns match the schema keys exactly', (_name, table, schema) => {
    const columnKeys = Object.keys(getTableColumns(table)).sort();
    const schemaKeys = Object.keys(schema.shape).sort();
    expect(columnKeys).toEqual(schemaKeys);
  });

  it('importProposal table columns match the schema keys exactly', () => {
    const columnKeys = Object.keys(getTableColumns(importProposalsTable)).sort();
    const schemaKeys = Object.keys(importProposalSchema.shape).sort();
    expect(columnKeys).toEqual(schemaKeys);
  });

  it.each(importCases)(
    '%s domain fixture satisfies the drizzle select schema',
    (_name, table, _schema, fixture) => {
      const selectSchema = createSelectSchema(table);
      expect(selectSchema.safeParse(fixture).success).toBe(true);
    },
  );

  it('import-spine fixtures round-trip through SQLite unchanged', () => {
    const { db } = createDb(':memory:');
    db.insert(entityTables.project).values(project).run();
    db.insert(importJobsTable).values(job).run();
    db.insert(evidenceTable).values(evidenceFixture).run();
    db.insert(observationsTable).values(observation).run();
    db.insert(fieldProvenanceTable).values(provenance).run();
    expect(importJobSchema.parse(db.select().from(importJobsTable).get())).toEqual(job);
    expect(evidenceSchema.parse(db.select().from(evidenceTable).get())).toEqual(evidenceFixture);
    expect(observationSchema.parse(db.select().from(observationsTable).get())).toEqual(observation);
    expect(fieldProvenanceSchema.parse(db.select().from(fieldProvenanceTable).get())).toEqual(
      provenance,
    );
  });
});

describe('findings tables align with domain Zod schemas (ADR-0023, plan M2)', () => {
  const disposition = makeFindingDisposition(project.id, { status: 'falsePositive' });

  it('finding_dispositions table columns match the schema keys exactly', () => {
    const columnKeys = Object.keys(getTableColumns(findingDispositionsTable)).sort();
    const schemaKeys = Object.keys(findingDispositionSchema.shape).sort();
    expect(columnKeys).toEqual(schemaKeys);
  });

  it('a disposition fixture satisfies the drizzle select schema', () => {
    const selectSchema = createSelectSchema(findingDispositionsTable);
    expect(selectSchema.safeParse(disposition).success).toBe(true);
  });

  it('a disposition round-trips through SQLite unchanged', () => {
    const { db } = createDb(':memory:');
    db.insert(entityTables.project).values(project).run();
    db.insert(findingDispositionsTable).values(disposition).run();
    expect(
      findingDispositionSchema.parse(db.select().from(findingDispositionsTable).get()),
    ).toEqual(disposition);
  });
});

describe('entities round-trip through SQLite unchanged', () => {
  it('inserts every fixture and reads back deep-equal rows', () => {
    const { db } = createDb(':memory:');

    // dependency order
    const inserts = [
      ['project', project],
      ['site', site],
      ['zone', zone],
      ['device', device],
      ['device', device2],
      ['network', network],
      ['network', network2],
      ['interface', iface],
      ['interface', iface2],
      ['address', address],
      ['link', link],
      ['service', service],
      ['policyRule', rule],
      ['flow', flow],
      ['identity', identity],
      ['roleAssignment', roleAssignment],
    ] as const;

    for (const [entityType, entity] of inserts) {
      db.insert(entityTables[entityType]).values(entity).run();
    }

    for (const [entityType, schema, fixture] of cases) {
      const rows = db.select().from(entityTables[entityType]).all();
      const match = rows.find((r) => 'id' in r && r.id === fixture.id);
      expect(match, `${entityType} row not found`).toBeDefined();
      expect(schema.parse(match)).toEqual(fixture);
    }
  });
});
