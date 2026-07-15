import type { Baseline, Device, Service } from '../../entities.js';
import type { FieldProvenance } from '../../imports.js';
import type { ProjectState } from '../../state.js';
import type { DetectionDraft, Rule } from '../rule.js';

/**
 * M7 — exposed-service family (design §3.8, ADR-0025): high-risk exposed
 * management services and clear-text / obsolete protocols. The management rule
 * reads the Baseline (M4): a management service is a finding only when it
 * departs from the expected-service Baseline for its scope, and the finding
 * cites the Baseline id + version.
 */

/** High-risk remote-management services, by well-known port. */
const MANAGEMENT_PORTS: Record<number, string> = {
  22: 'SSH',
  23: 'Telnet',
  135: 'RPC',
  445: 'SMB',
  3389: 'RDP',
  5900: 'VNC',
  5985: 'WinRM',
  5986: 'WinRM',
};

/** Clear-text / obsolete protocols, by well-known port. */
const CLEARTEXT_PORTS: Record<number, string> = {
  21: 'FTP',
  23: 'Telnet',
  69: 'TFTP',
  110: 'POP3',
  143: 'IMAP',
  161: 'SNMP',
  389: 'LDAP',
  513: 'rlogin',
  514: 'rsh',
};

function deviceOf(state: ProjectState, service: Service): Device | undefined {
  return service.deviceId ? state.devices.find((d) => d.id === service.deviceId) : undefined;
}

/** Networks a device's interfaces are members of. */
function deviceNetworkIds(state: ProjectState, device: Device): Set<string> {
  const ids = new Set<string>();
  for (const iface of state.interfaces) {
    if (iface.deviceId === device.id && iface.networkId) ids.add(iface.networkId);
  }
  return ids;
}

/** Baselines whose scope governs this device (device, its zone, or its networks). */
function applicableBaselines(state: ProjectState, device: Device): Baseline[] {
  const networkIds = deviceNetworkIds(state, device);
  return state.baselines.filter((b) => {
    switch (b.scope.kind) {
      case 'device':
        return b.scope.id === device.id;
      case 'zone':
        return device.zoneId != null && b.scope.id === device.zoneId;
      case 'network':
        return networkIds.has(b.scope.id);
    }
  });
}

function baselineExpects(baseline: Baseline, service: Service): boolean {
  return baseline.expectedServices.some(
    (e) =>
      (e.protocol === service.protocol || e.protocol === 'any') &&
      (e.port === null || e.port === service.portStart),
  );
}

function serviceProvenance(provenance: readonly FieldProvenance[], service: Service) {
  return provenance
    .filter((row) => row.entityType === 'service' && row.entityId === service.id)
    .map((row) => row.id);
}

export const exposedManagementServiceRule: Rule = {
  id: 'service.exposedManagement',
  ruleVersion: '1.0.0',
  category: 'high-risk exposed management service',
  defaultSeverity: 'high',
  detect(ctx) {
    const drafts: DetectionDraft[] = [];
    for (const service of ctx.state.services) {
      const port = service.portStart;
      if (port == null || !(port in MANAGEMENT_PORTS)) continue;
      const device = deviceOf(ctx.state, service);
      if (!device) continue;

      const baselines = applicableBaselines(ctx.state, device);
      const expectingBaseline = baselines.find((b) => baselineExpects(b, service));
      if (expectingBaseline) continue; // expected here — not a finding

      const cited = baselines[0];
      const citation = cited
        ? ` It departs from Baseline "${cited.name}" (v${cited.version}) for this scope.`
        : ' No expected-service Baseline governs this scope.';
      drafts.push({
        affected: { kind: 'device', id: device.id },
        salientKey: `exposedManagement:${service.protocol}:${port}`,
        title: `Exposed management service: ${MANAGEMENT_PORTS[port]} on ${device.name}`,
        evidenceRefs: [],
        contributingProvenanceRows: serviceProvenance(ctx.provenance, service),
        baseConfidence: 0.6,
        explanation: `${MANAGEMENT_PORTS[port]} (${service.protocol}/${port}) is exposed on ${device.name}.${citation}`,
        verificationSteps: [
          'Confirm the management service should be reachable, and from where.',
          cited
            ? 'If it is expected, add it to the Baseline; otherwise restrict or remove the exposure.'
            : 'Define an expected-service Baseline for this scope to govern management exposure.',
        ],
      });
    }
    return drafts;
  },
};

export const clearTextProtocolRule: Rule = {
  id: 'service.clearTextProtocol',
  ruleVersion: '1.0.0',
  category: 'clear-text or obsolete protocol',
  defaultSeverity: 'medium',
  detect(ctx) {
    const drafts: DetectionDraft[] = [];
    for (const service of ctx.state.services) {
      const port = service.portStart;
      if (port == null || !(port in CLEARTEXT_PORTS)) continue;
      const device = deviceOf(ctx.state, service);
      drafts.push({
        affected: device ? { kind: 'device', id: device.id } : null,
        salientKey: `clearText:${service.id}:${port}`,
        title: `Clear-text / obsolete protocol: ${CLEARTEXT_PORTS[port]}`,
        evidenceRefs: [],
        contributingProvenanceRows: serviceProvenance(ctx.provenance, service),
        baseConfidence: 0.6,
        explanation: `${CLEARTEXT_PORTS[port]} (${service.protocol}/${port}) transmits without encryption or is obsolete.`,
        verificationSteps: ['Replace with an encrypted equivalent, or restrict the exposure.'],
      });
    }
    return drafts;
  },
};

export const exposedServiceRules: readonly Rule[] = [
  exposedManagementServiceRule,
  clearTextProtocolRule,
];
