import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_STATE_SCHEMA_VERSION,
  deviceStateJsonSchema,
  validateDeviceStateReport,
} from '../src/device-state.js';
import { runValidator } from '../src/cli.js';

/** M4 DoD (ADR-0018): the contract validates offline, strict P2 / loose P3. */

const samplePath = join(import.meta.dirname, 'fixtures', 'sample-report.json');
const sample = () => JSON.parse(readFileSync(samplePath, 'utf8'));

describe('device-state contract (ADR-0018)', () => {
  it('accepts the conformant 3-host sample', () => {
    const result = validateDeviceStateReport(sample());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.hostCount).toBe(3);
    expect(result.schemaVersion).toBe(DEVICE_STATE_SCHEMA_VERSION);
  });

  it('rejects a report missing a required P2 field, naming the path', () => {
    const doc = sample();
    delete doc.hosts[0].hostname;
    const result = validateDeviceStateReport(doc);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'hosts.0.hostname')).toBe(true);
  });

  it('rejects unknown keys in the strict P2 sections', () => {
    const doc = sample();
    doc.hosts[0].interfaces[0].speed = '1Gbps';
    const result = validateDeviceStateReport(doc);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes('interfaces'))).toBe(true);
  });

  it('accepts arbitrary shapes in the loose P3 sections', () => {
    const doc = sample();
    doc.hosts[0].processes = [{ pid: 1, exe: 'C:\\evil.exe', whatever: { nested: true } }];
    doc.hosts[0].persistence = [{ mechanism: 'run-key', value: 'x' }];
    expect(validateDeviceStateReport(doc).ok).toBe(true);
  });

  it('rejects a wrong schemaVersion', () => {
    const doc = sample();
    doc.schemaVersion = '0.9.0';
    expect(validateDeviceStateReport(doc).ok).toBe(false);
  });
});

describe('validator CLI (offline, without the app)', () => {
  it('validates the sample from disk with exit code 0', () => {
    const result = runValidator([samplePath]);
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toContain('valid');
    expect(result.lines[0]).toContain('3 host(s)');
  });

  it('rejects a malformed report with exit code 1 and per-path issues', () => {
    const dir = mkdtempSync(join(tmpdir(), 'netplan-validate-'));
    const bad = sample();
    delete bad.hosts[1].deviceId;
    bad.hosts[1].listeningPorts[0].port = 99999;
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify(bad));

    const result = runValidator([file]);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toContain('hosts.1.deviceId');
    expect(result.lines.join('\n')).toContain('hosts.1.listeningPorts.0.port');
  });

  it('reports usage and IO errors distinctly', () => {
    expect(runValidator([]).exitCode).toBe(2);
    expect(runValidator(['does-not-exist.json']).exitCode).toBe(2);
  });
});

describe('generated JSON-Schema artifact (ADR-0017)', () => {
  it('the checked-in artifact matches the current Zod source', () => {
    const artifact = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'schema', 'device-state.schema.json'), 'utf8'),
    );
    expect(artifact).toEqual(deviceStateJsonSchema());
  });

  it('pins the schema version as a constant', () => {
    const artifact = deviceStateJsonSchema();
    expect(JSON.stringify(artifact)).toContain(DEVICE_STATE_SCHEMA_VERSION);
  });
});
