import { describe, expect, it } from 'vitest';
import {
  NETPLAN_BUNDLE_VERSION,
  applyRedaction,
  makeBundle,
  netplanBundleSchema,
  type ProjectState,
} from '../src/index.js';
import {
  makeAddress,
  makeDevice,
  makeEvidence,
  makeImportJob,
  makeInterface,
  makeLink,
  makeNetwork,
  makePolicyRule,
  makeProject,
  makeService,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';

function sampleState(): ProjectState {
  const project = makeProject();
  const site = makeSite(project.id);
  const zone = makeZone(site);
  const device = makeDevice(project.id, { zoneId: zone.id, serialNumber: 'SN-123' });
  const iface = makeInterface(device);
  const address = makeAddress(iface, { value: '10.1.2.3' });
  const network = makeNetwork(project.id);
  const network2 = makeNetwork(project.id, { name: 'Servers', vlanId: 20 });
  const device2 = makeDevice(project.id, { name: 'sw1', deviceType: 'switch' });
  const iface2 = makeInterface(device2, { name: 'ge-0' });
  const link = makeLink(iface, iface2);
  const service = makeService(project.id);
  const rule = makePolicyRule(network, network2, { serviceId: service.id, owner: 'alice' });
  return {
    project,
    sites: [site],
    zones: [zone],
    devices: [device, device2],
    interfaces: [iface, iface2],
    addresses: [address],
    networks: [network, network2],
    links: [link],
    services: [service],
    policyRules: [rule],
    flows: [],
    identities: [],
    roleAssignments: [],
  };
}

const NOW = '2026-07-15T12:00:00.000Z';

describe('.netplan bundle (ADR-0016)', () => {
  it('round-trips a full project state with identical identifiers', () => {
    const state = sampleState();
    const bundle = makeBundle(state, NOW);

    expect(bundle.format).toBe('netplan');
    expect(bundle.version).toBe(NETPLAN_BUNDLE_VERSION);

    // serialize → parse → identical (byte-level via JSON)
    const parsed = netplanBundleSchema.parse(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.project).toEqual(state);
  });

  it('carries the Phase-2 seams: empty evidence subtree and hash manifest', () => {
    const bundle = makeBundle(sampleState(), NOW);
    expect(bundle.evidence).toEqual([]);
    expect(bundle.manifest).toEqual({ files: [] });
  });

  it('round-trips an evidence subtree with a hash manifest (ADR-0019)', () => {
    const state = sampleState();
    const job = makeImportJob(state.project.id, { status: 'committed' });
    const inline = makeEvidence(job, { filename: 'scan.xml' });
    const dropped = makeEvidence(job, {
      filename: 'capture.pcap',
      contentClass: 'binaryCapture',
      retention: 'hashOnly',
      sha256: 'b'.repeat(64),
    });
    const bundle = makeBundle(state, NOW, {
      evidence: [
        { record: inline, encoding: 'utf8', content: '<xml/>' },
        { record: dropped, encoding: 'base64', content: null },
      ],
      importJobs: [job],
    });

    const parsed = netplanBundleSchema.parse(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.evidence).toHaveLength(2);
    expect(parsed.evidence[0]?.content).toBe('<xml/>');
    // provenance survives the dropped blob: hash + manifest entry remain
    expect(parsed.evidence[1]?.content).toBeNull();
    expect(parsed.manifest.files).toEqual([
      { path: `evidence/${inline.id}/scan.xml`, sha256: inline.sha256 },
      { path: `evidence/${dropped.id}/capture.pcap`, sha256: dropped.sha256 },
    ]);
    expect(parsed.importJobs).toEqual([job]);
  });

  it('still parses a version-1 bundle without the evidence subtree', () => {
    const v1 = JSON.parse(JSON.stringify(makeBundle(sampleState(), NOW)));
    v1.version = 1;
    delete v1.evidence;
    delete v1.importJobs;
    delete v1.manifest;
    const parsed = netplanBundleSchema.parse(v1);
    expect(parsed.evidence).toEqual([]);
    expect(parsed.importJobs).toEqual([]);
    expect(parsed.manifest).toEqual({ files: [] });
  });

  it('rejects a bundle with an unknown format marker', () => {
    const bundle = JSON.parse(JSON.stringify(makeBundle(sampleState(), NOW)));
    bundle.format = 'zip';
    expect(netplanBundleSchema.safeParse(bundle).success).toBe(false);
  });
});

describe('redaction profiles (design §3.12)', () => {
  it('blanks configured string fields at serialize time and leaves the rest intact', () => {
    const state = sampleState();
    const redacted = applyRedaction(state, {
      name: 'client-facing',
      fields: ['device.serialNumber', 'address.value', 'policyRule.owner'],
    });

    expect(redacted.devices.every((d) => d.serialNumber === '')).toBe(true);
    expect(redacted.addresses.every((a) => a.value === '[redacted]' || a.value === '')).toBe(true);
    expect(redacted.policyRules.every((r) => r.owner === '')).toBe(true);

    // identifiers and relationships untouched
    expect(redacted.devices.map((d) => d.id)).toEqual(state.devices.map((d) => d.id));
    expect(redacted.interfaces).toEqual(state.interfaces);

    // the original state is not mutated
    expect(state.devices[0]?.serialNumber).toBe('SN-123');
  });

  it('a redacted state still satisfies the bundle schema', () => {
    const redacted = applyRedaction(sampleState(), {
      name: 'x',
      fields: ['device.serialNumber', 'device.location', 'address.value'],
    });
    const bundle = makeBundle(redacted, NOW);
    expect(netplanBundleSchema.safeParse(JSON.parse(JSON.stringify(bundle))).success).toBe(true);
  });
});
