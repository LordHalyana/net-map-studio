import { describe, expect, it } from 'vitest';
import { buildCandidates } from '../src/pipeline/candidates.js';
import { contributorScore, combineConfidence } from '../src/confidence.js';
import { makeEvidence, makeImportJob, makeObservation, makeProject } from '../src/fixtures.js';
import type { Evidence, Observation, ObservationClaim } from '../src/index.js';

/**
 * M2 dedup + confidence DoD (plan §2): same host from two sources dedups to
 * one candidate; conflicting values become competing field candidates (never
 * silently merged); Flows aggregate per (source, destination, service);
 * scores follow the §3.7 contributor table.
 */

const project = makeProject();
const job = makeImportJob(project.id);
const deviceStateEvidence = makeEvidence(job, { filename: 'device-state.json' });
const nmapJob = makeImportJob(project.id, { parserName: 'nmap-xml' });
const nmapEvidence = makeEvidence(nmapJob, {
  filename: 'scan.xml',
  sha256: 'c'.repeat(64),
});

function obs(
  evidence: Evidence,
  claim: ObservationClaim,
  overrides: Partial<Observation> = {},
): Observation {
  return makeObservation(evidence, { claim, ...overrides });
}

describe('device deduplication across sources', () => {
  it('two sources observing the same MAC dedup to one device with fields from both', () => {
    const fromScript = obs(
      deviceStateEvidence,
      {
        targetKind: 'device',
        device: { stableId: 'machine-1', mac: 'AA:BB:CC:00:00:01', hostname: 'Web01' },
        fields: { name: 'web01', os: 'Ubuntu 24.04' },
      },
      { contributor: 'stableDeviceId' },
    );
    const fromNmap = obs(
      nmapEvidence,
      {
        targetKind: 'device',
        device: { mac: 'aa-bb-cc-00-00-01', ip: '10.0.0.10' },
        fields: { vendor: 'Dell Inc.' },
      },
      { contributor: 'exactMacMatch' },
    );

    const set = buildCandidates([fromScript, fromNmap]);
    expect(set.devices).toHaveLength(1);
    const device = set.devices[0]!;
    expect(device.hints.macs).toContain('aa:bb:cc:00:00:01');
    expect(device.hints.stableIds).toContain('machine-1');
    expect(device.hints.ips).toContain('10.0.0.10');

    // one winning value per field, each traceable to its observations
    expect(device.fields.name?.[0]?.value).toBe('web01');
    expect(device.fields.os?.[0]?.value).toBe('Ubuntu 24.04');
    expect(device.fields.vendor?.[0]?.value).toBe('Dell Inc.');
    expect(device.fields.vendor?.[0]?.observations).toEqual([fromNmap.id]);
    expect(device.observations).toHaveLength(2);
  });

  it('unrelated hosts stay separate', () => {
    const a = obs(deviceStateEvidence, {
      targetKind: 'device',
      device: { mac: 'aa:bb:cc:00:00:01' },
      fields: { name: 'web01' },
    });
    const b = obs(deviceStateEvidence, {
      targetKind: 'device',
      device: { mac: 'aa:bb:cc:00:00:02' },
      fields: { name: 'web02' },
    });
    expect(buildCandidates([a, b]).devices).toHaveLength(2);
  });

  it('conflicting field values become competing candidates, never a silent merge', () => {
    const fromScript = obs(
      deviceStateEvidence,
      {
        targetKind: 'device',
        device: { stableId: 'machine-1', mac: 'aa:bb:cc:00:00:01' },
        fields: { name: 'web01' },
      },
      { contributor: 'stableDeviceId' },
    );
    const fromNmap = obs(
      nmapEvidence,
      {
        targetKind: 'device',
        device: { mac: 'aa:bb:cc:00:00:01' },
        fields: { name: 'legacy-web' },
      },
      { contributor: 'hostnameMatch' },
    );

    const set = buildCandidates([fromScript, fromNmap]);
    expect(set.devices).toHaveLength(1);
    const name = set.devices[0]!.fields.name!;
    expect(name).toHaveLength(2);
    // ordered by confidence: the stable-id source wins, the other is retained
    expect(name[0]?.value).toBe('web01');
    expect(name[1]?.value).toBe('legacy-web');
    expect(set.devices[0]!.conflicts).toContain('name');
  });

  it('a service claim on an unknown host implies a device candidate', () => {
    const service = obs(nmapEvidence, {
      targetKind: 'service',
      device: { ip: '10.0.0.99' },
      protocol: 'tcp',
      port: 443,
      fields: { name: 'https' },
    });
    const set = buildCandidates([service]);
    expect(set.devices).toHaveLength(1);
    expect(set.devices[0]!.impliedOnly).toBe(true);
    expect(set.services).toHaveLength(1);
    expect(set.services[0]!.deviceKey).toBe(set.devices[0]!.key);
  });
});

describe('confidence scoring (§3.7)', () => {
  it('scores a candidate from its contributor table entries', () => {
    const single = obs(
      nmapEvidence,
      {
        targetKind: 'device',
        device: { hostname: 'lonely' },
        fields: { name: 'lonely' },
      },
      { contributor: 'hostnameMatch' },
    );
    const set = buildCandidates([single]);
    expect(set.devices[0]!.confidence).toBeCloseTo(contributorScore('hostnameMatch'), 5);
  });

  it('corroboration from two sources raises confidence monotonically', () => {
    const a = obs(
      deviceStateEvidence,
      {
        targetKind: 'device',
        device: { mac: 'aa:bb:cc:00:00:01' },
        fields: { name: 'web01' },
      },
      { contributor: 'stableDeviceId' },
    );
    const b = obs(
      nmapEvidence,
      {
        targetKind: 'device',
        device: { mac: 'aa:bb:cc:00:00:01' },
        fields: { name: 'web01' },
      },
      { contributor: 'exactMacMatch' },
    );
    const combined = buildCandidates([a, b]).devices[0]!;
    const expected = combineConfidence([
      contributorScore('stableDeviceId'),
      contributorScore('exactMacMatch'),
    ]);
    expect(combined.confidence).toBeCloseTo(expected, 5);
    expect(combined.confidence).toBeGreaterThan(contributorScore('stableDeviceId'));
    // the agreed field value carries the corroborated confidence too
    expect(combined.fields.name?.[0]?.confidence).toBeCloseTo(expected, 5);
  });
});

describe('flow aggregation (ADR-0019/0020)', () => {
  const flowClaim = (
    port: number,
    firstSeen: string,
    lastSeen: string,
    count = 1,
  ): ObservationClaim => ({
    targetKind: 'flow',
    source: { ip: '10.0.0.10' },
    destination: { ip: '10.0.0.20' },
    protocol: 'tcp',
    port,
    firstSeen,
    lastSeen,
    count,
  });

  it('aggregates one record per (source, destination, service) with count/first/last', () => {
    const t1 = '2026-07-01T00:00:00.000Z';
    const t2 = '2026-07-02T00:00:00.000Z';
    const t3 = '2026-07-03T00:00:00.000Z';
    const set = buildCandidates([
      obs(deviceStateEvidence, flowClaim(5432, t2, t2), { contributor: 'trafficObservation' }),
      obs(deviceStateEvidence, flowClaim(5432, t1, t1, 4), { contributor: 'trafficObservation' }),
      obs(deviceStateEvidence, flowClaim(5432, t3, t3), { contributor: 'trafficObservation' }),
      obs(deviceStateEvidence, flowClaim(443, t1, t3), { contributor: 'trafficObservation' }),
    ]);

    expect(set.flows).toHaveLength(2);
    const db = set.flows.find((f) => f.port === 5432)!;
    expect(db.count).toBe(6);
    expect(db.firstSeen).toBe(t1);
    expect(db.lastSeen).toBe(t3);
    expect(db.observations).toHaveLength(3);
  });

  it('a flow endpoint with no known device does not invent a device candidate', () => {
    const set = buildCandidates([
      obs(
        deviceStateEvidence,
        flowClaim(443, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'),
      ),
    ]);
    expect(set.devices).toHaveLength(0);
    expect(set.flows).toHaveLength(1);
  });
});

describe('identity keying (ADR-0022)', () => {
  it('the same domain principal on two hosts is one candidate; local users stay per-host', () => {
    const domainOnA = obs(deviceStateEvidence, {
      targetKind: 'identity',
      device: { hostname: 'host-a' },
      identity: { scope: 'domain', name: 'Alice', domain: 'corp' },
      fields: { kind: 'user' },
    });
    const domainOnB = obs(deviceStateEvidence, {
      targetKind: 'identity',
      device: { hostname: 'host-b' },
      identity: { scope: 'domain', name: 'ALICE', domain: 'CORP' },
      fields: { kind: 'user' },
    });
    const localOnA = obs(deviceStateEvidence, {
      targetKind: 'identity',
      device: { hostname: 'host-a' },
      identity: { scope: 'local', name: 'bob', domain: '' },
      fields: { kind: 'user' },
    });
    const localOnB = obs(deviceStateEvidence, {
      targetKind: 'identity',
      device: { hostname: 'host-b' },
      identity: { scope: 'local', name: 'bob', domain: '' },
      fields: { kind: 'user' },
    });

    const set = buildCandidates([domainOnA, domainOnB, localOnA, localOnB]);
    const domainIdentities = set.identities.filter((i) => i.scope === 'domain');
    expect(domainIdentities).toHaveLength(1);
    expect(domainIdentities[0]!.deviceKeys).toHaveLength(2);
    expect(set.identities.filter((i) => i.scope === 'local')).toHaveLength(2);
  });

  it('role assignments key on identity, privilege and host', () => {
    const adminA = obs(deviceStateEvidence, {
      targetKind: 'roleAssignment',
      device: { hostname: 'host-a' },
      identity: { scope: 'domain', name: 'alice', domain: 'CORP' },
      privilege: 'localAdministrator',
      detail: '',
    });
    const adminAAgain = obs(nmapEvidence, {
      targetKind: 'roleAssignment',
      device: { hostname: 'host-a' },
      identity: { scope: 'domain', name: 'alice', domain: 'CORP' },
      privilege: 'localAdministrator',
      detail: '',
    });
    const adminB = obs(deviceStateEvidence, {
      targetKind: 'roleAssignment',
      device: { hostname: 'host-b' },
      identity: { scope: 'domain', name: 'alice', domain: 'CORP' },
      privilege: 'localAdministrator',
      detail: '',
    });

    const set = buildCandidates([adminA, adminAAgain, adminB]);
    expect(set.roleAssignments).toHaveLength(2);
    expect(set.identities).toHaveLength(1);
  });
});

describe('interface and address claims', () => {
  it('addresses key per (device, kind, value) and attach to interfaces when named', () => {
    const iface = obs(deviceStateEvidence, {
      targetKind: 'interface',
      device: { stableId: 'm1' },
      name: 'eth0',
      fields: { kind: 'ethernet' },
    });
    const addr = obs(deviceStateEvidence, {
      targetKind: 'address',
      device: { stableId: 'm1' },
      interfaceName: 'eth0',
      kind: 'ipv4',
      value: '10.0.0.10',
    });
    const addrAgain = obs(nmapEvidence, {
      targetKind: 'address',
      device: { stableId: 'm1' },
      interfaceName: null,
      kind: 'ipv4',
      value: '010.000.000.010',
    });

    const set = buildCandidates([iface, addr, addrAgain]);
    expect(set.interfaces).toHaveLength(1);
    expect(set.addresses).toHaveLength(1);
    expect(set.addresses[0]!.value).toBe('10.0.0.10');
    expect(set.addresses[0]!.interfaceName).toBe('eth0');
    expect(set.addresses[0]!.observations).toHaveLength(2);
  });
});
