import { describe, expect, it } from 'vitest';
import {
  normalizeHostname,
  normalizeIp,
  normalizeMac,
  normalizeObservation,
} from '../src/pipeline/normalize.js';
import { makeEvidence, makeImportJob, makeObservation, makeProject } from '../src/fixtures.js';

/** M2 (ADR-0020): canonical forms for MACs, IPs and hostnames. */

describe('normalizeMac', () => {
  it('canonicalizes every common MAC notation to lowercase colon form', () => {
    expect(normalizeMac('AA:BB:CC:DD:EE:FF')).toBe('aa:bb:cc:dd:ee:ff');
    expect(normalizeMac('aa-bb-cc-dd-ee-ff')).toBe('aa:bb:cc:dd:ee:ff');
    expect(normalizeMac('AABB.CCDD.EEFF')).toBe('aa:bb:cc:dd:ee:ff');
    expect(normalizeMac('aabbccddeeff')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('leaves an unrecognizable value untouched rather than guessing', () => {
    expect(normalizeMac('not-a-mac')).toBe('not-a-mac');
    expect(normalizeMac('aa:bb:cc:dd:ee')).toBe('aa:bb:cc:dd:ee');
  });
});

describe('normalizeIp', () => {
  it('strips leading zeros from IPv4 octets', () => {
    expect(normalizeIp('010.001.000.005')).toBe('10.1.0.5');
    expect(normalizeIp('192.168.1.1')).toBe('192.168.1.1');
  });

  it('lowercases and compresses IPv6', () => {
    expect(normalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(normalizeIp('FE80::1')).toBe('fe80::1');
    expect(normalizeIp('::1')).toBe('::1');
  });

  it('leaves an unrecognizable value untouched', () => {
    expect(normalizeIp('example.com')).toBe('example.com');
  });
});

describe('normalizeHostname', () => {
  it('lowercases and strips the trailing dot', () => {
    expect(normalizeHostname('Web01.Corp.Example.COM.')).toBe('web01.corp.example.com');
    expect(normalizeHostname('db01')).toBe('db01');
  });
});

describe('normalizeObservation', () => {
  it('normalizes device hints and address values in place', () => {
    const project = makeProject();
    const job = makeImportJob(project.id);
    const evidence = makeEvidence(job);
    const observation = makeObservation(evidence, {
      claim: {
        targetKind: 'address',
        device: { mac: 'AA-BB-CC-DD-EE-01', hostname: 'Web01.' },
        interfaceName: null,
        kind: 'mac',
        value: 'AA-BB-CC-DD-EE-01',
      },
    });

    const normalized = normalizeObservation(observation);
    expect(normalized.claim).toMatchObject({
      device: { mac: 'aa:bb:cc:dd:ee:01', hostname: 'web01' },
      value: 'aa:bb:cc:dd:ee:01',
    });
    // pure: the input observation is untouched
    expect(observation.claim).toMatchObject({ value: 'AA-BB-CC-DD-EE-01' });
  });

  it('normalizes flow endpoints and identity domains', () => {
    const project = makeProject();
    const job = makeImportJob(project.id);
    const evidence = makeEvidence(job);

    const flow = makeObservation(evidence, {
      contributor: 'trafficObservation',
      claim: {
        targetKind: 'flow',
        source: { ip: '010.000.000.001' },
        destination: { ip: '2001:0DB8::0001', hostname: 'API.example.com.' },
        protocol: 'tcp',
        port: 443,
        firstSeen: null,
        lastSeen: null,
        count: 1,
      },
    });
    expect(normalizeObservation(flow).claim).toMatchObject({
      source: { ip: '10.0.0.1' },
      destination: { ip: '2001:db8::1', hostname: 'api.example.com' },
    });

    const identity = makeObservation(evidence, {
      claim: {
        targetKind: 'identity',
        device: { hostname: 'Web01' },
        identity: { scope: 'domain', name: 'Alice', domain: 'corp' },
        fields: {},
      },
    });
    // domain names are case-insensitive: canonicalized uppercase; the
    // principal's display name is preserved
    expect(normalizeObservation(identity).claim).toMatchObject({
      device: { hostname: 'web01' },
      identity: { scope: 'domain', name: 'Alice', domain: 'CORP' },
    });
  });
});
