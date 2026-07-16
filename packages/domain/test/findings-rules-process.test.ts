import { describe, expect, it } from 'vitest';
import {
  processPersistenceRules,
  engineConfigSchema,
  runAnalysis,
  type AnalysisContext,
  type DetectionRecord,
  type EngineConfig,
  type HostSecurityInventory,
  type ProjectState,
} from '../src/index.js';
import { makeDevice, makeHostInventory, makeProject } from '../src/fixtures.js';

const project = makeProject();
const device = makeDevice(project.id, { name: 'ws-01' });

function state(): ProjectState {
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
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
  };
}

function run(inventory: HostSecurityInventory | null, config?: EngineConfig): DetectionRecord[] {
  const ctx: AnalysisContext = {
    state: state(),
    provenance: [],
    evidence: [],
    hostInventories: inventory ? [inventory] : [],
    config: config ?? engineConfigSchema.parse({}),
    opSeq: 1,
  };
  return runAnalysis(processPersistenceRules, ctx).detections;
}

describe('M6 process & persistence family (§3.8)', () => {
  it('flags installed remote-access software that is not on the approved allowlist', () => {
    const inventory = makeHostInventory(device.id, {
      software: [{ name: 'AnyDesk', publisher: '', version: '', remoteAccess: true }],
    });
    const detections = run(inventory);
    const finding = detections.find((d) => d.category === 'unapproved remote-access software');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
  });

  it('drops the remote-access finding once the tool is allowlisted', () => {
    const inventory = makeHostInventory(device.id, {
      software: [{ name: 'AnyDesk', publisher: '', version: '', remoteAccess: true }],
    });
    const config = engineConfigSchema.parse({ lists: { approvedSoftware: ['AnyDesk'] } });
    expect(run(inventory, config)).toEqual([]);
  });

  it('flags a persistence entry launching from an unexpected location', () => {
    const inventory = makeHostInventory(device.id, {
      persistence: [
        { kind: 'startup', name: 'Updater', command: '', path: 'C:\\Users\\Public\\svc.exe' },
      ],
    });
    const finding = run(inventory).find((d) => d.category === 'unusual persistence entry');
    expect(finding).toBeDefined();
    expect(finding?.affected).toEqual({ kind: 'device', id: device.id });
  });

  it('does not flag a persistence entry from a normal location', () => {
    const inventory = makeHostInventory(device.id, {
      persistence: [
        { kind: 'service', name: 'Spooler', command: '', path: 'C:\\Windows\\System32\\spool.exe' },
      ],
    });
    expect(run(inventory)).toEqual([]);
  });

  it('produces no false clean when a host has no process/persistence data', () => {
    expect(run(makeHostInventory(device.id))).toEqual([]);
    expect(run(null)).toEqual([]);
  });
});
