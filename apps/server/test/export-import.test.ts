import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { netplanBundleSchema } from '@netplan/domain';
import {
  makeAddress,
  makeInterface,
  makeLink,
  makeNetwork,
  makePolicyRule,
  makeService,
  makeSite,
  makeZone,
  makeDevice,
} from '@netplan/domain/fixtures';
import { buildApp } from '../src/app.js';
import { createDeviceOp, createInterfaceOp, createNetworkOp, opId } from './helpers.js';

async function createApp(): Promise<FastifyInstance> {
  return buildApp({ dbFile: ':memory:', logger: false });
}

/** Drive the API to build a project exercising every entity type. */
async function populate(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST',
    url: '/projects',
    payload: { name: 'Export Fixture' },
  });
  const project = res.json();
  const site = makeSite(project.id);
  const zone = makeZone(site);
  const device = makeDevice(project.id, { zoneId: zone.id, serialNumber: 'SN-42' });
  const device2 = makeDevice(project.id, { name: 'sw', deviceType: 'switch' });
  const iface = makeInterface(device);
  const iface2 = makeInterface(device2, { name: 'ge-0' });
  const address = makeAddress(iface, { value: '192.168.1.1' });
  const vlan10 = makeNetwork(project.id);
  const vlan20 = makeNetwork(project.id, { name: 'Servers', vlanId: 20 });
  const link = makeLink(iface, iface2, { label: 'uplink' });
  const service = makeService(project.id);
  const rule = makePolicyRule(vlan10, vlan20, { serviceId: service.id, owner: 'alice' });

  const ops = [
    {
      id: opId(),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'site', entity: site },
    },
    {
      id: opId(),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'zone', entity: zone },
    },
    createDeviceOp(project, device),
    createDeviceOp(project, device2),
    createInterfaceOp(project, iface),
    createInterfaceOp(project, iface2),
    {
      id: opId(),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'address', entity: address },
    },
    createNetworkOp(project, vlan10),
    createNetworkOp(project, vlan20),
    {
      id: opId(),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'service', entity: service },
    },
    { id: opId(), projectId: project.id, kind: 'CreateLink', link },
    { id: opId(), projectId: project.id, kind: 'CreatePolicyRule', rule },
  ];
  for (const op of ops) {
    const applied = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/operations`,
      payload: op,
    });
    expect(applied.statusCode).toBe(200);
  }
  return project;
}

describe('.netplan export/import round-trip (M10 DoD, acceptance #10)', () => {
  it('restores every object identifier and relationship identically into an empty store', async () => {
    const source = await createApp();
    const project = await populate(source);

    const exported = await source.inject({ method: 'GET', url: `/projects/${project.id}/export` });
    expect(exported.statusCode).toBe(200);
    const bundle = netplanBundleSchema.parse(exported.json());

    const sourceGraph = (
      await source.inject({ method: 'GET', url: `/projects/${project.id}/graph` })
    ).json();

    // fresh empty store
    const target = await createApp();
    const imported = await target.inject({
      method: 'POST',
      url: '/projects/import',
      payload: bundle,
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().id).toBe(project.id);

    const targetGraph = (
      await target.inject({ method: 'GET', url: `/projects/${project.id}/graph` })
    ).json();
    expect(targetGraph).toEqual(sourceGraph);
  });

  it('rejects importing a bundle whose project already exists', async () => {
    const app = await createApp();
    const project = await populate(app);
    const bundle = (
      await app.inject({ method: 'GET', url: `/projects/${project.id}/export` })
    ).json();

    const res = await app.inject({ method: 'POST', url: '/projects/import', payload: bundle });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a malformed bundle', async () => {
    const app = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/projects/import',
      payload: { format: 'zip', version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('applies a redaction profile at export time', async () => {
    const app = await createApp();
    const project = await populate(app);

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/export?redact=device.serialNumber,address.value,policyRule.owner`,
    });
    const bundle = netplanBundleSchema.parse(res.json());
    expect(bundle.project.devices.every((d) => d.serialNumber === '')).toBe(true);
    expect(bundle.project.policyRules.every((r) => r.owner === '')).toBe(true);
    expect(bundle.project.addresses.every((a) => a.value === '' || a.value === '[redacted]')).toBe(
      true,
    );
    // unredacted fields intact
    expect(bundle.project.devices.some((d) => d.name)).toBe(true);
  });
});

describe('structured exports (M10 DoD)', () => {
  it('produces CSV for devices with a header and one row per device', async () => {
    const app = await createApp();
    const project = await populate(app);

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/export/csv/devices`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('name');
    expect(lines).toHaveLength(3); // header + 2 devices
  });

  it('rejects CSV export for an unknown entity type', async () => {
    const app = await createApp();
    const project = await populate(app);
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/export/csv/nonsense`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('renders an HTML design report naming the project and its devices', async () => {
    const app = await createApp();
    const project = await populate(app);

    const res = await app.inject({ method: 'GET', url: `/projects/${project.id}/report` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Export Fixture');
    expect(res.body).toContain('sw');
    expect(res.body).toContain('uplink');
  });
});
