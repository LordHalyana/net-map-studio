import { describe, expect, it } from 'vitest';
import {
  applyResolution,
  buildCandidates,
  buildProposal,
  generateProvenanceRows,
  type Observation,
  type ObservationClaim,
  type ProjectState,
} from '../src/index.js';
import {
  makeAddress,
  makeDevice,
  makeEvidence,
  makeIdentity,
  makeImportJob,
  makeInterface,
  makeObservation,
  makeProject,
  makeRoleAssignment,
} from '../src/fixtures.js';

/** M3 DoD (plan §2, ADR-0021): propose → resolve → the pending ChangeSet is rewritten. */

const NOW = '2026-07-15T12:00:00.000Z';
const project = makeProject();
const job = makeImportJob(project.id);
const evidence = makeEvidence(job);

function emptyState(): ProjectState {
  return {
    project,
    sites: [],
    zones: [],
    devices: [],
    interfaces: [],
    addresses: [],
    networks: [],
    links: [],
    services: [],
    policyRules: [],
    flows: [],
    hostArtifacts: [],
    reports: [],
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
  };
}

function obs(claim: ObservationClaim, contributor: Observation['contributor']): Observation {
  return makeObservation(evidence, { claim, contributor });
}

const webHost = { stableId: 'm-web', mac: 'aa:bb:cc:00:00:01', hostname: 'web01' };

function webObservations(): Observation[] {
  return [
    obs(
      {
        targetKind: 'device',
        device: webHost,
        fields: { name: 'web01', os: 'Ubuntu 24.04', deviceType: 'server' },
      },
      'stableDeviceId',
    ),
    obs(
      { targetKind: 'interface', device: webHost, name: 'eth0', fields: { kind: 'ethernet' } },
      'stableDeviceId',
    ),
    obs(
      {
        targetKind: 'address',
        device: webHost,
        interfaceName: 'eth0',
        kind: 'ipv4',
        value: '10.0.0.10',
      },
      'stableDeviceId',
    ),
    obs(
      {
        targetKind: 'service',
        device: webHost,
        protocol: 'tcp',
        port: 443,
        fields: { name: 'https', process: 'nginx' },
      },
      'stableDeviceId',
    ),
    obs(
      {
        targetKind: 'identity',
        device: webHost,
        identity: { scope: 'domain', name: 'alice', domain: 'CORP' },
        fields: { kind: 'user' },
      },
      'stableDeviceId',
    ),
    obs(
      {
        targetKind: 'roleAssignment',
        device: webHost,
        identity: { scope: 'domain', name: 'alice', domain: 'CORP' },
        privilege: 'localAdministrator',
        detail: '',
      },
      'stableDeviceId',
    ),
  ];
}

describe('buildProposal against an empty graph', () => {
  it('proposes Create operations for every candidate, none applied, all Observed', () => {
    const observations = webObservations();
    const candidates = buildCandidates(observations);
    const proposal = buildProposal(emptyState(), job, candidates, NOW);

    expect(proposal.conflicts).toEqual([]);
    const kinds = proposal.operations.map((o) =>
      o.kind === 'CreateEntity' ? o.payload.entityType : o.kind,
    );
    expect(kinds).toEqual([
      'device',
      'interface',
      'address',
      'service',
      'identity',
      'roleAssignment',
    ]);
    for (const operation of proposal.operations) {
      expect(operation.kind).toBe('CreateEntity');
      // report records (M11) carry no lifecycle and never appear in proposals
      if (operation.kind === 'CreateEntity' && operation.payload.entityType !== 'report') {
        expect(operation.payload.entity.lifecycleState).toBe('observed');
        expect(operation.payload.entity.projectId).toBe(project.id);
      }
    }
  });

  it('a flow to an unknown peer gets an external endpoint, never a Device', () => {
    const flowObs = obs(
      {
        targetKind: 'flow',
        source: { ip: '10.0.0.10' },
        destination: { ip: '203.0.113.99' },
        protocol: 'tcp',
        port: 443,
        firstSeen: null,
        lastSeen: null,
        count: 7,
      },
      'trafficObservation',
    );
    const candidates = buildCandidates([...webObservations(), flowObs]);
    const proposal = buildProposal(emptyState(), job, candidates, NOW);

    const flowOp = proposal.operations.find(
      (o) => o.kind === 'CreateEntity' && o.payload.entityType === 'flow',
    );
    expect(flowOp).toBeDefined();
    if (flowOp?.kind === 'CreateEntity' && flowOp.payload.entityType === 'flow') {
      const flow = flowOp.payload.entity;
      // the known source resolves to the imported device; the unknown peer stays external
      expect(flow.source.kind).toBe('device');
      expect(flow.destination).toEqual({ kind: 'external', value: '203.0.113.99' });
      expect(flow.observationCount).toBe(7);
      expect(flow.firstSeen).toBe(NOW); // no timestamp observed → import time
      // destination is external, so no service link
      expect(flow.serviceId).toBeNull();
    }
    const deviceCreates = proposal.operations.filter(
      (o) => o.kind === 'CreateEntity' && o.payload.entityType === 'device',
    );
    expect(deviceCreates).toHaveLength(1);
  });
});

describe('conflicts against the committed graph', () => {
  function committedState(): ProjectState {
    const device = makeDevice(project.id, {
      name: 'web01',
      deviceType: 'server',
      os: '',
      lifecycleState: 'observed',
    });
    const iface = makeInterface(device, { name: 'eth0', lifecycleState: 'observed' });
    const mac = makeAddress(iface, { kind: 'mac', value: 'aa:bb:cc:00:00:01' });
    return { ...emptyState(), devices: [device], interfaces: [iface], addresses: [mac] };
  }

  it('a candidate matching an existing device produces a conflict, not a silent merge', () => {
    const state = committedState();
    const candidates = buildCandidates(webObservations());
    const proposal = buildProposal(state, job, candidates, NOW);

    expect(proposal.conflicts).toHaveLength(1);
    const conflict = proposal.conflicts[0]!;
    expect(conflict.entityType).toBe('device');
    expect(conflict.existingEntityId).toBe(state.devices[0]!.id);
    expect(conflict.resolution).toBe('pending');
    // the proposal still contains the Create — nothing was merged automatically
    expect(
      proposal.operations.some(
        (o) => o.kind === 'CreateEntity' && o.payload.entityType === 'device',
      ),
    ).toBe(true);
  });

  it('merge rewrites the Create into SetFields on the existing object and re-targets children', () => {
    const state = committedState();
    const candidates = buildCandidates(webObservations());
    const proposal = buildProposal(state, job, candidates, NOW);
    const conflict = proposal.conflicts[0]!;

    const resolved = applyResolution(proposal, state, candidates, conflict.id, 'merge');

    // no device Create remains; the os gap-fill became a SetField on the existing id
    expect(
      resolved.operations.some(
        (o) => o.kind === 'CreateEntity' && o.payload.entityType === 'device',
      ),
    ).toBe(false);
    const setOs = resolved.operations.find((o) => o.kind === 'SetField' && o.field === 'os');
    expect(setOs).toBeDefined();
    if (setOs?.kind === 'SetField') {
      expect(setOs.entityId).toBe(state.devices[0]!.id);
      expect(setOs.value).toBe('Ubuntu 24.04');
      expect(setOs.previousValue).toBe('');
    }
    // duplicate children (eth0, the MAC address) were dropped; the service and
    // identity are new and now reference the existing device
    const creates = resolved.operations.filter((o) => o.kind === 'CreateEntity');
    const createdTypes = creates.map((o) =>
      o.kind === 'CreateEntity' ? o.payload.entityType : '',
    );
    expect(createdTypes).not.toContain('interface');
    expect(createdTypes).toContain('service');
    const serviceOp = creates.find(
      (o) => o.kind === 'CreateEntity' && o.payload.entityType === 'service',
    );
    if (serviceOp?.kind === 'CreateEntity' && serviceOp.payload.entityType === 'service') {
      expect(serviceOp.payload.entity.deviceId).toBe(state.devices[0]!.id);
    }
    // the ipv4 address was NOT on the existing device — it must survive,
    // re-targeted to the existing eth0
    const addressOp = creates.find(
      (o) => o.kind === 'CreateEntity' && o.payload.entityType === 'address',
    );
    expect(addressOp).toBeDefined();
    if (addressOp?.kind === 'CreateEntity' && addressOp.payload.entityType === 'address') {
      expect(addressOp.payload.entity.interfaceId).toBe(state.interfaces[0]!.id);
      expect(addressOp.payload.entity.value).toBe('10.0.0.10');
    }
    expect(resolved.entityIds[candidates.devices[0]!.key]).toBe(state.devices[0]!.id);
  });

  it('merge keeps existing values on conflicting fields; replace overwrites them', () => {
    const state = committedState();
    state.devices[0] = { ...state.devices[0]!, os: 'Debian 11' };
    const candidates = buildCandidates(webObservations());
    const proposal = buildProposal(state, job, candidates, NOW);
    const conflict = proposal.conflicts[0]!;
    expect(conflict.fieldDiffs.some((d) => d.field === 'os')).toBe(true);

    const merged = applyResolution(proposal, state, candidates, conflict.id, 'merge');
    expect(merged.operations.some((o) => o.kind === 'SetField' && o.field === 'os')).toBe(false);

    const replaced = applyResolution(proposal, state, candidates, conflict.id, 'replace');
    const setOs = replaced.operations.find((o) => o.kind === 'SetField' && o.field === 'os');
    expect(setOs).toBeDefined();
    if (setOs?.kind === 'SetField') {
      expect(setOs.value).toBe('Ubuntu 24.04');
      expect(setOs.previousValue).toBe('Debian 11');
    }
  });

  it('ignore drops the candidate and everything that depends on it', () => {
    const state = committedState();
    const candidates = buildCandidates(webObservations());
    const proposal = buildProposal(state, job, candidates, NOW);
    const conflict = proposal.conflicts[0]!;

    const resolved = applyResolution(proposal, state, candidates, conflict.id, 'ignore');
    // the device and all its dependents are gone; only the domain identity
    // remains (it does not belong to the host)
    const remainingTypes = resolved.operations.map((o) =>
      o.kind === 'CreateEntity' ? o.payload.entityType : o.kind,
    );
    expect(remainingTypes).toEqual(['identity']);
  });

  it('keep-separate leaves the pending ChangeSet untouched', () => {
    const state = committedState();
    const candidates = buildCandidates(webObservations());
    const proposal = buildProposal(state, job, candidates, NOW);
    const conflict = proposal.conflicts[0]!;

    const resolved = applyResolution(proposal, state, candidates, conflict.id, 'keepSeparate');
    expect(resolved.operations).toEqual(proposal.operations);
    expect(resolved.conflicts[0]!.resolution).toBe('keepSeparate');
  });

  it('a domain principal already committed reconciles onto the one identity (ADR-0022)', () => {
    const state = emptyState();
    const identity = makeIdentity(project.id, {
      scope: 'domain',
      name: 'alice',
      domain: 'CORP',
      deviceId: null,
    });
    const host = makeDevice(project.id, { name: 'host-b' });
    const assignment = makeRoleAssignment(identity, { deviceId: host.id });
    state.identities = [identity];
    state.devices = [host];
    state.roleAssignments = [assignment];

    const candidates = buildCandidates(webObservations());
    const proposal = buildProposal(state, job, candidates, NOW);
    const identityConflict = proposal.conflicts.find((c) => c.entityType === 'identity');
    expect(identityConflict).toBeDefined();

    const resolved = applyResolution(proposal, state, candidates, identityConflict!.id, 'merge');
    // no identity Create remains; the new host's role assignment references the
    // one committed identity
    expect(
      resolved.operations.some(
        (o) => o.kind === 'CreateEntity' && o.payload.entityType === 'identity',
      ),
    ).toBe(false);
    const roleOp = resolved.operations.find(
      (o) => o.kind === 'CreateEntity' && o.payload.entityType === 'roleAssignment',
    );
    expect(roleOp).toBeDefined();
    if (roleOp?.kind === 'CreateEntity' && roleOp.payload.entityType === 'roleAssignment') {
      expect(roleOp.payload.entity.identityId).toBe(identity.id);
    }
  });
});

describe('provenance generation (ADR-0008)', () => {
  it('every imported field gets an accepted row per supporting observation; competing values are rejected rows', () => {
    const observations = webObservations();
    const candidates = buildCandidates(observations);
    const proposal = buildProposal(emptyState(), job, candidates, NOW);
    const byId = new Map(observations.map((o) => [o.id, o]));

    const rows = generateProvenanceRows(proposal, candidates, byId, job, NOW);
    const deviceId = proposal.entityIds[candidates.devices[0]!.key]!;
    const osRow = rows.find((r) => r.entityType === 'device' && r.field === 'os');
    expect(osRow).toMatchObject({
      entityId: deviceId,
      status: 'accepted',
      sourceType: 'imported',
      importJobId: job.id,
      evidenceId: evidence.id,
      parserVersion: job.parserVersion,
      observedValue: 'Ubuntu 24.04',
    });
    // service, address, identity and roleAssignment rows exist too
    for (const entityType of ['service', 'address', 'identity', 'roleAssignment']) {
      expect(rows.some((r) => r.entityType === entityType)).toBe(true);
    }
  });

  it('an ignored candidate leaves no provenance', () => {
    const state = emptyState();
    const committed = makeDevice(project.id, { name: 'web01' });
    const iface = makeInterface(committed, { name: 'eth0' });
    const mac = makeAddress(iface, { kind: 'mac', value: 'aa:bb:cc:00:00:01' });
    state.devices = [committed];
    state.interfaces = [iface];
    state.addresses = [mac];

    const observations = webObservations();
    const candidates = buildCandidates(observations);
    const proposal = buildProposal(state, job, candidates, NOW);
    const resolved = applyResolution(
      proposal,
      state,
      candidates,
      proposal.conflicts[0]!.id,
      'ignore',
    );
    const rows = generateProvenanceRows(
      resolved,
      candidates,
      new Map(observations.map((o) => [o.id, o])),
      job,
      NOW,
    );
    expect(rows.filter((r) => r.entityType === 'device')).toEqual([]);
  });
});
