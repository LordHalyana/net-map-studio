import { combineConfidence, contributorScore, type Confidence } from '../confidence.js';
import type { DeviceHints, FlowEndpointHints, Observation, ObservationId } from '../imports.js';
import type { AddressKind, IdentityScope, Protocol, RolePrivilege } from '../entities.js';
import { fieldValueSchema, type FieldValue } from '../operations.js';
import { normalizeObservation } from './normalize.js';

/**
 * Deduplication + confidence scoring (ADR-0020, plan M2): normalized
 * Observations collapse into per-entity candidates keyed by natural identity,
 * with competing field values retained side by side — the system never
 * silently merges (§3.7). The output feeds the M3 ChangeSet builder and the
 * provenance sidecar.
 */

/** One observed value for one field, with the observations supporting it. */
export interface FieldValueCandidate {
  value: FieldValue;
  confidence: Confidence;
  observations: ObservationId[];
}

/** Competing values per field, strongest first — [0] is the winning value. */
export type CandidateFields = Record<string, FieldValueCandidate[]>;

export interface MergedDeviceHints {
  stableIds: string[];
  macs: string[];
  ips: string[];
  hostnames: string[];
}

export interface DeviceCandidate {
  targetKind: 'device';
  key: string;
  hints: MergedDeviceHints;
  fields: CandidateFields;
  /** Fields with more than one observed value — the reconciliation queue's input. */
  conflicts: string[];
  observations: ObservationId[];
  confidence: Confidence;
  /** True when only child claims referenced this host (no direct device claim). */
  impliedOnly: boolean;
}

export interface InterfaceCandidate {
  targetKind: 'interface';
  key: string;
  deviceKey: string;
  name: string;
  fields: CandidateFields;
  conflicts: string[];
  observations: ObservationId[];
  confidence: Confidence;
}

export interface AddressCandidate {
  targetKind: 'address';
  key: string;
  deviceKey: string;
  interfaceName: string | null;
  kind: AddressKind;
  value: string;
  observations: ObservationId[];
  confidence: Confidence;
}

export interface ServiceCandidate {
  targetKind: 'service';
  key: string;
  deviceKey: string;
  protocol: Protocol;
  port: number;
  fields: CandidateFields;
  conflicts: string[];
  observations: ObservationId[];
  confidence: Confidence;
}

export interface FlowCandidate {
  targetKind: 'flow';
  key: string;
  source: FlowEndpointHints;
  destination: FlowEndpointHints;
  protocol: Protocol;
  port: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  count: number;
  observations: ObservationId[];
  confidence: Confidence;
}

export interface IdentityCandidate {
  targetKind: 'identity';
  key: string;
  scope: IdentityScope;
  /** Display name: first observed casing (dedup folds case). */
  name: string;
  domain: string;
  /** Hosts the principal was observed on (M10 correlation input). */
  deviceKeys: string[];
  fields: CandidateFields;
  conflicts: string[];
  observations: ObservationId[];
  confidence: Confidence;
}

export interface RoleAssignmentCandidate {
  targetKind: 'roleAssignment';
  key: string;
  identityKey: string;
  deviceKey: string;
  privilege: RolePrivilege;
  detail: string;
  observations: ObservationId[];
  confidence: Confidence;
}

export interface CandidateSet {
  devices: DeviceCandidate[];
  interfaces: InterfaceCandidate[];
  addresses: AddressCandidate[];
  services: ServiceCandidate[];
  flows: FlowCandidate[];
  identities: IdentityCandidate[];
  roleAssignments: RoleAssignmentCandidate[];
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

interface DeviceAccumulator {
  stableIds: Set<string>;
  macs: Set<string>;
  ips: Set<string>;
  hostnames: Set<string>;
  /** field -> serialized value -> supporting observations */
  fields: Map<string, Map<string, Observation[]>>;
  observations: Map<ObservationId, Observation>;
  hasDeviceClaim: boolean;
}

function scoreOf(observation: Observation): Confidence {
  return contributorScore(observation.contributor);
}

function combineObservations(observations: Iterable<Observation>): Confidence {
  return combineConfidence([...observations].map(scoreOf));
}

function addFieldValue(
  fields: Map<string, Map<string, Observation[]>>,
  field: string,
  value: FieldValue,
  observation: Observation,
): void {
  const serialized = JSON.stringify(value);
  const byValue = fields.get(field) ?? new Map<string, Observation[]>();
  const supporters = byValue.get(serialized) ?? [];
  supporters.push(observation);
  byValue.set(serialized, supporters);
  fields.set(field, byValue);
}

function finalizeFields(fields: Map<string, Map<string, Observation[]>>): {
  fields: CandidateFields;
  conflicts: string[];
} {
  const out: CandidateFields = {};
  const conflicts: string[] = [];
  for (const [field, byValue] of fields) {
    const candidates: FieldValueCandidate[] = [...byValue.entries()].map(
      ([serialized, supporters]) => ({
        value: fieldValueSchema.parse(JSON.parse(serialized)),
        confidence: combineObservations(supporters),
        observations: supporters.map((o) => o.id),
      }),
    );
    candidates.sort(
      (a, b) => b.confidence - a.confidence || b.observations.length - a.observations.length,
    );
    out[field] = candidates;
    if (candidates.length > 1) conflicts.push(field);
  }
  return { fields: out, conflicts: conflicts.sort() };
}

class DeviceCorrelator {
  private accumulators: DeviceAccumulator[] = [];

  /** Find-or-create the accumulator for a hint set, merging accumulators bridged by it. */
  resolve(hints: DeviceHints): DeviceAccumulator {
    const matches = new Set<DeviceAccumulator>();
    for (const acc of this.accumulators) {
      if (
        (hints.stableId && acc.stableIds.has(hints.stableId)) ||
        (hints.mac && acc.macs.has(hints.mac)) ||
        (hints.hostname && acc.hostnames.has(hints.hostname)) ||
        (hints.ip && acc.ips.has(hints.ip))
      ) {
        matches.add(acc);
      }
    }
    let target: DeviceAccumulator;
    if (matches.size === 0) {
      target = {
        stableIds: new Set(),
        macs: new Set(),
        ips: new Set(),
        hostnames: new Set(),
        fields: new Map(),
        observations: new Map(),
        hasDeviceClaim: false,
      };
      this.accumulators.push(target);
    } else {
      const [first, ...rest] = [...matches];
      target = first!;
      // an observation can bridge previously separate accumulators — merge them
      for (const other of rest) {
        for (const v of other.stableIds) target.stableIds.add(v);
        for (const v of other.macs) target.macs.add(v);
        for (const v of other.ips) target.ips.add(v);
        for (const v of other.hostnames) target.hostnames.add(v);
        for (const [field, byValue] of other.fields) {
          const targetByValue = target.fields.get(field) ?? new Map<string, Observation[]>();
          for (const [serialized, supporters] of byValue) {
            const merged = targetByValue.get(serialized) ?? [];
            merged.push(...supporters);
            targetByValue.set(serialized, merged);
          }
          target.fields.set(field, targetByValue);
        }
        for (const [id, o] of other.observations) target.observations.set(id, o);
        target.hasDeviceClaim = target.hasDeviceClaim || other.hasDeviceClaim;
        this.accumulators = this.accumulators.filter((a) => a !== other);
      }
    }
    if (hints.stableId) target.stableIds.add(hints.stableId);
    if (hints.mac) target.macs.add(hints.mac);
    if (hints.ip) target.ips.add(hints.ip);
    if (hints.hostname) target.hostnames.add(hints.hostname);
    return target;
  }

  all(): DeviceAccumulator[] {
    return this.accumulators;
  }

  keyOf(acc: DeviceAccumulator): string {
    const first = (set: Set<string>) => [...set].sort()[0];
    const stableId = first(acc.stableIds);
    if (stableId) return `device:stableId=${stableId}`;
    const mac = first(acc.macs);
    if (mac) return `device:mac=${mac}`;
    const hostname = first(acc.hostnames);
    if (hostname) return `device:hostname=${hostname}`;
    return `device:ip=${first(acc.ips) ?? 'unknown'}`;
  }
}

/**
 * The dedup + scoring stages in one pass. Input observations are normalized
 * first (idempotent), so callers can hand raw adapter output straight in.
 */
export function buildCandidates(rawObservations: readonly Observation[]): CandidateSet {
  const observations = rawObservations.map(normalizeObservation);
  const correlator = new DeviceCorrelator();

  // Pass 1: correlate every host reference so keys are stable before children key on them.
  const accByObservation = new Map<ObservationId, DeviceAccumulator>();
  for (const observation of observations) {
    const { claim } = observation;
    if (claim.targetKind === 'flow') continue; // never invent a Device for a flow endpoint
    const acc = correlator.resolve(claim.device);
    accByObservation.set(observation.id, acc);
    acc.observations.set(observation.id, observation);
    if (claim.targetKind === 'device') {
      acc.hasDeviceClaim = true;
      for (const [field, value] of Object.entries(claim.fields)) {
        if (value !== undefined) addFieldValue(acc.fields, field, value, observation);
      }
    }
    // an observed MAC/IP/hostname address is itself an identity hint for its host
    if (claim.targetKind === 'address') {
      if (claim.kind === 'mac') acc.macs.add(claim.value);
      if (claim.kind === 'ipv4' || claim.kind === 'ipv6') acc.ips.add(claim.value);
      if (claim.kind === 'hostname') acc.hostnames.add(claim.value);
    }
  }

  const devices: DeviceCandidate[] = correlator.all().map((acc) => {
    const { fields, conflicts } = finalizeFields(acc.fields);
    return {
      targetKind: 'device',
      key: correlator.keyOf(acc),
      hints: {
        stableIds: [...acc.stableIds].sort(),
        macs: [...acc.macs].sort(),
        ips: [...acc.ips].sort(),
        hostnames: [...acc.hostnames].sort(),
      },
      fields,
      conflicts,
      observations: [...acc.observations.keys()],
      confidence: combineObservations(acc.observations.values()),
      impliedOnly: !acc.hasDeviceClaim,
    };
  });
  const deviceKeyByAcc = new Map(correlator.all().map((acc) => [acc, correlator.keyOf(acc)]));
  const deviceKeyFor = (observation: Observation): string => {
    const acc = accByObservation.get(observation.id);
    const key = acc ? deviceKeyByAcc.get(acc) : undefined;
    if (!key) throw new Error('device correlation lost an observation');
    return key;
  };

  // Pass 2: child candidates keyed within their host.
  const interfaces = new Map<
    string,
    {
      deviceKey: string;
      name: string;
      fields: Map<string, Map<string, Observation[]>>;
      obs: Observation[];
    }
  >();
  const addresses = new Map<
    string,
    {
      deviceKey: string;
      interfaceName: string | null;
      kind: AddressKind;
      value: string;
      obs: Observation[];
    }
  >();
  const services = new Map<
    string,
    {
      deviceKey: string;
      protocol: Protocol;
      port: number;
      fields: Map<string, Map<string, Observation[]>>;
      obs: Observation[];
    }
  >();
  const flows = new Map<
    string,
    {
      source: FlowEndpointHints;
      destination: FlowEndpointHints;
      protocol: Protocol;
      port: number | null;
      firstSeen: string | null;
      lastSeen: string | null;
      count: number;
      obs: Observation[];
    }
  >();
  const identities = new Map<
    string,
    {
      scope: IdentityScope;
      name: string;
      domain: string;
      deviceKeys: Set<string>;
      fields: Map<string, Map<string, Observation[]>>;
      obs: Observation[];
    }
  >();
  const roleAssignments = new Map<
    string,
    {
      identityKey: string;
      deviceKey: string;
      privilege: RolePrivilege;
      detail: string;
      obs: Observation[];
    }
  >();

  const identityKeyOf = (
    identity: { scope: IdentityScope; name: string; domain: string },
    deviceKey: string,
  ): string =>
    identity.scope === 'domain'
      ? `identity:domain:${identity.domain}\\${identity.name.toLowerCase()}`
      : `identity:local:${deviceKey}:${identity.name.toLowerCase()}`;

  const flowEndpointKey = (hints: FlowEndpointHints): string =>
    hints.ip ?? hints.hostname ?? hints.mac ?? 'unknown';

  for (const observation of observations) {
    const { claim } = observation;
    switch (claim.targetKind) {
      case 'device':
        break;
      case 'interface': {
        const deviceKey = deviceKeyFor(observation);
        const key = `${deviceKey}/iface:${claim.name}`;
        const entry = interfaces.get(key) ?? {
          deviceKey,
          name: claim.name,
          fields: new Map<string, Map<string, Observation[]>>(),
          obs: new Array<Observation>(),
        };
        for (const [field, value] of Object.entries(claim.fields)) {
          if (value !== undefined) addFieldValue(entry.fields, field, value, observation);
        }
        entry.obs.push(observation);
        interfaces.set(key, entry);
        break;
      }
      case 'address': {
        const deviceKey = deviceKeyFor(observation);
        const key = `${deviceKey}/addr:${claim.kind}=${claim.value}`;
        const entry = addresses.get(key) ?? {
          deviceKey,
          interfaceName: claim.interfaceName,
          kind: claim.kind,
          value: claim.value,
          obs: new Array<Observation>(),
        };
        entry.interfaceName = entry.interfaceName ?? claim.interfaceName;
        entry.obs.push(observation);
        addresses.set(key, entry);
        break;
      }
      case 'service': {
        const deviceKey = deviceKeyFor(observation);
        const key = `${deviceKey}/svc:${claim.protocol}/${claim.port}`;
        const entry = services.get(key) ?? {
          deviceKey,
          protocol: claim.protocol,
          port: claim.port,
          fields: new Map<string, Map<string, Observation[]>>(),
          obs: new Array<Observation>(),
        };
        for (const [field, value] of Object.entries(claim.fields)) {
          if (value !== undefined) addFieldValue(entry.fields, field, value, observation);
        }
        entry.obs.push(observation);
        services.set(key, entry);
        break;
      }
      case 'flow': {
        const key = `flow:${flowEndpointKey(claim.source)}->${flowEndpointKey(claim.destination)}:${claim.protocol}/${claim.port ?? 'any'}`;
        const entry = flows.get(key) ?? {
          source: claim.source,
          destination: claim.destination,
          protocol: claim.protocol,
          port: claim.port,
          firstSeen: claim.firstSeen,
          lastSeen: claim.lastSeen,
          count: 0,
          obs: new Array<Observation>(),
        };
        entry.count += claim.count;
        if (claim.firstSeen && (!entry.firstSeen || claim.firstSeen < entry.firstSeen)) {
          entry.firstSeen = claim.firstSeen;
        }
        if (claim.lastSeen && (!entry.lastSeen || claim.lastSeen > entry.lastSeen)) {
          entry.lastSeen = claim.lastSeen;
        }
        entry.obs.push(observation);
        flows.set(key, entry);
        break;
      }
      case 'identity': {
        const deviceKey = deviceKeyFor(observation);
        const key = identityKeyOf(claim.identity, deviceKey);
        const entry = identities.get(key) ?? {
          scope: claim.identity.scope,
          name: claim.identity.name,
          domain: claim.identity.domain,
          deviceKeys: new Set<string>(),
          fields: new Map<string, Map<string, Observation[]>>(),
          obs: new Array<Observation>(),
        };
        entry.deviceKeys.add(deviceKey);
        for (const [field, value] of Object.entries(claim.fields)) {
          if (value !== undefined) addFieldValue(entry.fields, field, value, observation);
        }
        entry.obs.push(observation);
        identities.set(key, entry);
        break;
      }
      case 'roleAssignment': {
        const deviceKey = deviceKeyFor(observation);
        const identityKey = identityKeyOf(claim.identity, deviceKey);
        // a role assignment implies its principal exists
        const identityEntry = identities.get(identityKey) ?? {
          scope: claim.identity.scope,
          name: claim.identity.name,
          domain: claim.identity.domain,
          deviceKeys: new Set<string>(),
          fields: new Map<string, Map<string, Observation[]>>(),
          obs: new Array<Observation>(),
        };
        identityEntry.deviceKeys.add(deviceKey);
        identities.set(identityKey, identityEntry);

        const key = `role:${identityKey}@${deviceKey}:${claim.privilege}:${claim.detail}`;
        const entry = roleAssignments.get(key) ?? {
          identityKey,
          deviceKey,
          privilege: claim.privilege,
          detail: claim.detail,
          obs: new Array<Observation>(),
        };
        entry.obs.push(observation);
        roleAssignments.set(key, entry);
        break;
      }
    }
  }

  return {
    devices,
    interfaces: [...interfaces.entries()].map(([key, entry]) => {
      const { fields, conflicts } = finalizeFields(entry.fields);
      return {
        targetKind: 'interface',
        key,
        deviceKey: entry.deviceKey,
        name: entry.name,
        fields,
        conflicts,
        observations: entry.obs.map((o) => o.id),
        confidence: combineObservations(entry.obs),
      };
    }),
    addresses: [...addresses.entries()].map(([key, entry]) => ({
      targetKind: 'address',
      key,
      deviceKey: entry.deviceKey,
      interfaceName: entry.interfaceName,
      kind: entry.kind,
      value: entry.value,
      observations: entry.obs.map((o) => o.id),
      confidence: combineObservations(entry.obs),
    })),
    services: [...services.entries()].map(([key, entry]) => {
      const { fields, conflicts } = finalizeFields(entry.fields);
      return {
        targetKind: 'service',
        key,
        deviceKey: entry.deviceKey,
        protocol: entry.protocol,
        port: entry.port,
        fields,
        conflicts,
        observations: entry.obs.map((o) => o.id),
        confidence: combineObservations(entry.obs),
      };
    }),
    flows: [...flows.entries()].map(([key, entry]) => ({
      targetKind: 'flow',
      key,
      source: entry.source,
      destination: entry.destination,
      protocol: entry.protocol,
      port: entry.port,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
      count: entry.count,
      observations: entry.obs.map((o) => o.id),
      confidence: combineObservations(entry.obs),
    })),
    identities: [...identities.entries()].map(([key, entry]) => {
      const { fields, conflicts } = finalizeFields(entry.fields);
      return {
        targetKind: 'identity',
        key,
        scope: entry.scope,
        name: entry.name,
        domain: entry.domain,
        deviceKeys: [...entry.deviceKeys].sort(),
        fields,
        conflicts,
        observations: entry.obs.map((o) => o.id),
        confidence: combineObservations(entry.obs),
      };
    }),
    roleAssignments: [...roleAssignments.entries()].map(([key, entry]) => ({
      targetKind: 'roleAssignment',
      key,
      identityKey: entry.identityKey,
      deviceKey: entry.deviceKey,
      privilege: entry.privilege,
      detail: entry.detail,
      observations: entry.obs.map((o) => o.id),
      confidence: combineObservations(entry.obs),
    })),
  };
}
