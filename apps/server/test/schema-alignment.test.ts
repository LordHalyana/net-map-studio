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
  makeAddress,
  makeDevice,
  makeInterface,
  makeLink,
  makeNetwork,
  makePolicyRule,
  makeProject,
  makeService,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';
import { entityTables } from '../src/db/schema.js';
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
