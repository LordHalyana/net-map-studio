import { computeDeviceCoverage, type InputClass } from '../coverage.js';
import { inventoryCoverage } from '../inputs.js';
import type { DetectionDraft, Rule } from '../rule.js';
import { flowEndpointDevice, policyAllows } from './helpers.js';

/**
 * M9 — segmentation, identity-anomaly & collection-quality families (design
 * §3.8, §3.11). Cross-zone flows unsanctioned by policy, service accounts with
 * admin across devices, and coverage-aware "incomplete collection" findings.
 * These emit Findings (not §3.11 RuleWarnings).
 */

export const crossZoneFlowRule: Rule = {
  id: 'segmentation.crossZoneFlow',
  ruleVersion: '1.0.0',
  category: 'unexpected cross-VLAN communication',
  defaultSeverity: 'medium',
  detect(ctx) {
    const drafts: DetectionDraft[] = [];
    for (const flow of ctx.state.flows) {
      const src = flowEndpointDevice(ctx.state, flow.source);
      const dst = flowEndpointDevice(ctx.state, flow.destination);
      if (!src || !dst) continue;
      if (src.zoneId == null || dst.zoneId == null || src.zoneId === dst.zoneId) continue;
      if (policyAllows(ctx.state, src, dst)) continue; // sanctioned by intended policy

      drafts.push({
        affected: { kind: 'device', id: src.id },
        salientKey: `crossZone:${src.id}:${dst.id}`,
        title: `Unexpected cross-zone communication: ${src.name} → ${dst.name}`,
        evidenceRefs: [],
        contributingProvenanceRows: [],
        baseConfidence: flow.confidence,
        certaintyFactor: 0.8,
        explanation: `Observed traffic from ${src.name} to ${dst.name} crosses a zone boundary with no intended allow PolicyRule sanctioning it — a possible segmentation bypass.`,
        verificationSteps: [
          'Confirm whether this cross-zone communication is intended.',
          'If intended, add a PolicyRule; otherwise investigate the segmentation gap.',
        ],
      });
    }
    return drafts;
  },
};

export const serviceAccountAdminRule: Rule = {
  id: 'identity.serviceAccountAdminSpread',
  ruleVersion: '1.0.0',
  category: 'privileged or service-account anomaly',
  defaultSeverity: 'high',
  detect(ctx) {
    const drafts: DetectionDraft[] = [];
    const serviceAccounts = ctx.state.identities.filter((i) => i.kind === 'serviceAccount');
    for (const identity of serviceAccounts) {
      const adminDevices = new Set(
        ctx.state.roleAssignments
          .filter(
            (r) =>
              r.identityId === identity.id &&
              r.privilege === 'localAdministrator' &&
              r.deviceId != null,
          )
          .map((r) => r.deviceId),
      );
      if (adminDevices.size < 2) continue;

      drafts.push({
        affected: null, // spans multiple devices — a project-scoped principal concern
        salientKey: `svcAdminSpread:${identity.id}`,
        title: `Service account with admin across ${adminDevices.size} devices: ${identity.name}`,
        evidenceRefs: [],
        contributingProvenanceRows: [],
        baseConfidence: 0.75,
        explanation: `Service account "${identity.name}" holds local administrator on ${adminDevices.size} devices — broad lateral-movement potential if compromised.`,
        verificationSteps: [
          'Confirm the service account requires admin on every device it is assigned to.',
          'Reduce the privilege footprint to least privilege where possible.',
        ],
      });
    }
    return drafts;
  },
};

/** Which finding families each input class is required by, for the coverage report. */
const FAMILY_REQUIREMENTS: { family: string; needsAny: InputClass[] }[] = [
  { family: 'filename / path', needsAny: ['fileInventory'] },
  { family: 'process & persistence', needsAny: ['processes', 'persistence', 'installedSoftware'] },
];

export const collectionQualityRule: Rule = {
  id: 'quality.incompleteCollection',
  ruleVersion: '1.0.0',
  category: 'evidence conflict or incomplete collection',
  defaultSeverity: 'low',
  detect(ctx) {
    const stateCoverage = computeDeviceCoverage(ctx.state);
    const drafts: DetectionDraft[] = [];
    for (const cov of stateCoverage) {
      const inventory = ctx.hostInventories.find((i) => i.deviceId === cov.deviceId);
      const available = new Set<InputClass>([
        ...cov.available,
        ...(inventory ? inventoryCoverage(inventory) : []),
      ]);
      const unevaluable = FAMILY_REQUIREMENTS.filter(
        (req) => !req.needsAny.some((c) => available.has(c)),
      ).map((req) => req.family);
      if (unevaluable.length === 0) continue;

      drafts.push({
        affected: { kind: 'device', id: cov.deviceId },
        salientKey: `coverage:${unevaluable.join(',')}`,
        title: `Incomplete collection on ${cov.deviceName}`,
        evidenceRefs: [],
        contributingProvenanceRows: [],
        // High confidence — we KNOW the data is missing — but low severity.
        baseConfidence: 0.9,
        explanation: `${cov.deviceName} was imported without the data these rule families need, so they could not be evaluated (not passed): ${unevaluable.join(', ')}.`,
        verificationSteps: [
          'Re-run the device-state collector on this device to gather the missing data.',
          'Treat the un-evaluated families as unknown, not clean.',
        ],
      });
    }
    return drafts;
  },
};

export const segmentationIdentityRules: readonly Rule[] = [
  crossZoneFlowRule,
  serviceAccountAdminRule,
  collectionQualityRule,
];
