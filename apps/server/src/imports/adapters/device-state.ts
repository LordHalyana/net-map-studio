import {
  DEVICE_STATE_SCHEMA_VERSION,
  deviceStateReportSchema,
  type DeviceStateHost,
} from '@netplan/import-contract';
import type { DeviceHints, IdentityRef, ObservationDraft } from '@netplan/domain';
import { guardedJsonParse } from '../guards.js';
import type { Adapter, AdapterContext } from './types.js';

/**
 * Device-state Adapter (ADR-0018/0020): the canonical report → Observations.
 * The client's stable machine id makes every claim a strong §3.7 contributor.
 * Principal names may be domain-qualified (`CORP\alice`, `alice@corp`) — those
 * become domain-scoped identity claims (ADR-0022).
 */

function inferAddressKind(value: string): 'mac' | 'ipv4' | 'ipv6' | 'hostname' {
  if (/^[0-9a-fA-F]{2}([:-][0-9a-fA-F]{2}){5}$/.test(value)) return 'mac';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return 'ipv4';
  if (value.includes(':')) return 'ipv6';
  return 'hostname';
}

/** `CORP\alice` and `alice@corp.example` are domain principals; bare names are local. */
export function parsePrincipal(raw: string): IdentityRef {
  const backslash = raw.indexOf('\\');
  if (backslash > 0) {
    return {
      scope: 'domain',
      domain: raw.slice(0, backslash),
      name: raw.slice(backslash + 1),
    };
  }
  const at = raw.indexOf('@');
  if (at > 0) {
    return { scope: 'domain', domain: raw.slice(at + 1), name: raw.slice(0, at) };
  }
  return { scope: 'local', domain: '', name: raw };
}

function osLabel(host: DeviceStateHost): string {
  return [host.os.name, host.os.version].filter(Boolean).join(' ');
}

function inferDeviceType(host: DeviceStateHost): 'server' | 'workstation' | undefined {
  const os = osLabel(host).toLowerCase();
  if (os.includes('server')) return 'server';
  if (/windows 1\d/.test(os) || os.includes('macos')) return 'workstation';
  return undefined;
}

function primaryIp(host: DeviceStateHost): string | undefined {
  for (const iface of host.interfaces) {
    for (const address of iface.addresses) {
      const kind = address.kind ?? inferAddressKind(address.value);
      if (kind === 'ipv4' && !address.value.startsWith('127.')) return address.value;
    }
  }
  return undefined;
}

function hostObservations(host: DeviceStateHost): ObservationDraft[] {
  const drafts: ObservationDraft[] = [];
  const observedAt = host.collectedAt;
  const hints: DeviceHints = {
    stableId: host.deviceId,
    hostname: host.hostname,
    ...(host.interfaces[0]?.mac ? { mac: host.interfaces[0].mac } : {}),
    ...(primaryIp(host) ? { ip: primaryIp(host) } : {}),
  };
  const claim = (draft: ObservationDraft) => drafts.push(draft);
  const deviceType = inferDeviceType(host);

  claim({
    contributor: 'stableDeviceId',
    observedAt,
    claim: {
      targetKind: 'device',
      device: hints,
      fields: {
        name: host.hostname,
        os: osLabel(host),
        ...(deviceType ? { deviceType } : {}),
      },
    },
  });

  for (const iface of host.interfaces) {
    claim({
      contributor: 'stableDeviceId',
      observedAt,
      claim: {
        targetKind: 'interface',
        device: hints,
        name: iface.name,
        fields: iface.kind ? { kind: iface.kind } : {},
      },
    });
    if (iface.mac) {
      claim({
        contributor: 'stableDeviceId',
        observedAt,
        claim: {
          targetKind: 'address',
          device: hints,
          interfaceName: iface.name,
          kind: 'mac',
          value: iface.mac,
        },
      });
    }
    for (const address of iface.addresses) {
      claim({
        contributor: 'stableDeviceId',
        observedAt,
        claim: {
          targetKind: 'address',
          device: hints,
          interfaceName: iface.name,
          kind: address.kind ?? inferAddressKind(address.value),
          value: address.value,
        },
      });
    }
  }

  for (const listener of host.listeningPorts) {
    claim({
      contributor: 'stableDeviceId',
      observedAt,
      claim: {
        targetKind: 'service',
        device: hints,
        protocol: listener.protocol === 'other' ? 'other' : listener.protocol,
        port: listener.port,
        fields: { name: listener.process, process: listener.process },
      },
    });
  }

  for (const connection of host.connections) {
    claim({
      contributor: 'trafficObservation',
      observedAt,
      claim: {
        targetKind: 'flow',
        source: { ip: connection.localAddress, hostname: host.hostname },
        destination: { ip: connection.remoteAddress },
        protocol: connection.protocol === 'other' ? 'other' : connection.protocol,
        port: connection.remotePort,
        firstSeen: observedAt,
        lastSeen: observedAt,
        count: 1,
      },
    });
  }

  for (const user of host.localUsers) {
    claim({
      contributor: 'stableDeviceId',
      observedAt,
      claim: {
        targetKind: 'identity',
        device: hints,
        identity: { scope: 'local', domain: '', name: user.name },
        fields: { kind: user.serviceAccount ? 'serviceAccount' : 'user' },
      },
    });
  }

  for (const group of host.localGroups) {
    claim({
      contributor: 'stableDeviceId',
      observedAt,
      claim: {
        targetKind: 'identity',
        device: hints,
        identity: { scope: 'local', domain: '', name: group.name },
        fields: { kind: 'group' },
      },
    });
    for (const member of group.members) {
      claim({
        contributor: 'stableDeviceId',
        observedAt,
        claim: {
          targetKind: 'roleAssignment',
          device: hints,
          identity: parsePrincipal(member),
          privilege: 'groupMember',
          detail: group.name,
        },
      });
    }
  }

  for (const admin of host.administrators) {
    claim({
      contributor: 'stableDeviceId',
      observedAt,
      claim: {
        targetKind: 'roleAssignment',
        device: hints,
        identity: parsePrincipal(admin),
        privilege: 'localAdministrator',
        detail: '',
      },
    });
  }
  for (const sudoer of host.sudoers) {
    claim({
      contributor: 'stableDeviceId',
      observedAt,
      claim: {
        targetKind: 'roleAssignment',
        device: hints,
        identity: parsePrincipal(sudoer),
        privilege: 'sudoer',
        detail: '',
      },
    });
  }

  return drafts;
}

export const deviceStateAdapter: Adapter = {
  name: 'device-state',
  version: '1.0.0',
  schemaVersion: DEVICE_STATE_SCHEMA_VERSION,
  parse(content: string, ctx: AdapterContext): ObservationDraft[] {
    const report = deviceStateReportSchema.parse(guardedJsonParse(content, ctx.limits));
    const drafts: ObservationDraft[] = [];
    for (const host of report.hosts) {
      ctx.budget.check();
      drafts.push(...hostObservations(host));
    }
    return drafts;
  },
};
