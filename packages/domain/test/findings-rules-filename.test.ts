import { describe, expect, it } from 'vitest';
import {
  filenamePathRules,
  engineConfigSchema,
  runAnalysis,
  type AnalysisContext,
  type DetectionRecord,
  type EngineConfig,
  type HostSecurityInventory,
  type ProjectState,
} from '../src/index.js';
import {
  makeDevice,
  makeEvidence,
  makeHostInventory,
  makeImportJob,
  makeProject,
} from '../src/fixtures.js';

const project = makeProject();
const device = makeDevice(project.id, { name: 'ws-01' });
const evidence = makeEvidence(makeImportJob(project.id));

function emptyState(): ProjectState {
  return {
    project,
    sites: [],
    zones: [],
    devices: [device],
    interfaces: [],
    addresses: [],
    networks: [],
    links: [],
    services: [],
    policyRules: [],
    flows: [],
    hostArtifacts: [],
    reports: [],
    importProfiles: [],
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
  };
}

function run(inventory: HostSecurityInventory | null, config?: EngineConfig): DetectionRecord[] {
  const ctx: AnalysisContext = {
    state: emptyState(),
    provenance: [],
    evidence: [],
    hostInventories: inventory ? [inventory] : [],
    config: config ?? engineConfigSchema.parse({}),
    opSeq: 1,
  };
  return runAnalysis(filenamePathRules, ctx).detections;
}

describe('M5 filename / path family (§3.8)', () => {
  it('flags a double-extension executable in a temp path (masquerade + unexpected location)', () => {
    const inventory = makeHostInventory(device.id, {
      evidenceId: evidence.id,
      files: [{ path: 'C:\\Users\\bob\\AppData\\Local\\Temp\\invoice.pdf.exe', sha256: null }],
    });
    const detections = run(inventory);
    const categories = detections.map((d) => d.category);
    expect(categories).toContain('masquerading or double-extension');
    expect(categories).toContain('unexpected executable location');

    const masq = detections.find((d) => d.category === 'masquerading or double-extension');
    expect(masq?.severity).toBe('high'); // rule-declared
    expect(masq?.confidence).toBeGreaterThan(0); // provenance-independent base confidence
    expect(masq?.evidenceRefs).toEqual([evidence.id]); // traces to its evidence
    expect(masq?.affected).toEqual({ kind: 'device', id: device.id });
  });

  it('yields a known-indicator match when a file hash is on the local IoC list', () => {
    const badHash = 'b'.repeat(64);
    const inventory = makeHostInventory(device.id, {
      evidenceId: evidence.id,
      files: [{ path: '/usr/local/bin/agent', sha256: badHash }],
    });
    const config = engineConfigSchema.parse({
      lists: { knownFileHashes: [badHash.toUpperCase()] },
    });
    const detections = run(inventory, config);
    const ioc = detections.find((d) => d.category === 'known indicator match');
    expect(ioc).toBeDefined();
    expect(ioc?.severity).toBe('critical');
  });

  it('flags an operator suspicious filename', () => {
    const inventory = makeHostInventory(device.id, {
      evidenceId: evidence.id,
      files: [{ path: 'C:\\Windows\\System32\\mimikatz.exe', sha256: null }],
    });
    const config = engineConfigSchema.parse({ lists: { suspiciousFilenames: ['mimikatz.exe'] } });
    const detections = run(inventory, config);
    expect(detections.some((d) => d.category === 'suspicious filename or path')).toBe(true);
  });

  it('produces no false clean when a host has no file data', () => {
    const bare = makeHostInventory(device.id, { evidenceId: evidence.id });
    expect(run(bare)).toEqual([]);
    // No inventory at all → also nothing (coverage handles the gap, M9).
    expect(run(null)).toEqual([]);
  });

  it('does not flag an ordinary executable in a normal location', () => {
    const inventory = makeHostInventory(device.id, {
      evidenceId: evidence.id,
      files: [{ path: 'C:\\Program Files\\App\\app.exe', sha256: null }],
    });
    expect(run(inventory)).toEqual([]);
  });
});
