import type { DeviceId } from '../../ids.js';
import type { DetectionDraft, Rule } from '../rule.js';
import { inventoryEvidence, isSuspectLocation } from './helpers.js';

/**
 * M6 — process & persistence family (design §3.8): unusual persistence entries
 * and unapproved remote-access software. Conservative and coverage-aware — a
 * host with no process/persistence data yields nothing (surfaced as coverage,
 * M9), never a false clean. The approved-software allowlist is Rule config
 * (ADR-0024); allowlisting a tool drops the finding on the next run.
 */

function deviceAffected(deviceId: DeviceId) {
  return { kind: 'device', id: deviceId } as const;
}

export const unapprovedRemoteAccessRule: Rule = {
  id: 'process.unapprovedRemoteAccess',
  ruleVersion: '1.0.0',
  category: 'unapproved remote-access software',
  defaultSeverity: 'high',
  detect(ctx) {
    const approved = ctx.lists.approvedSoftware.map((s) => s.toLowerCase());
    const drafts: DetectionDraft[] = [];
    for (const inv of ctx.hostInventories) {
      const evidenceRefs = inventoryEvidence(inv);
      for (const software of inv.software) {
        if (!software.remoteAccess) continue;
        if (approved.includes(software.name.toLowerCase())) continue;
        drafts.push({
          affected: deviceAffected(inv.deviceId),
          salientKey: `remoteAccess:${software.name.toLowerCase()}`,
          title: `Unapproved remote-access software: ${software.name}`,
          evidenceRefs,
          contributingProvenanceRows: [],
          baseConfidence: 0.7,
          explanation: `"${software.name}" provides remote access and is not on the approved-software allowlist.`,
          verificationSteps: [
            'Confirm whether this remote-access tool is sanctioned; if so, add it to the approved-software list.',
            'If not sanctioned, investigate how and when it was installed.',
          ],
        });
      }
    }
    return drafts;
  },
};

export const unusualPersistenceRule: Rule = {
  id: 'persistence.unusualEntry',
  ruleVersion: '1.0.0',
  category: 'unusual persistence entry',
  defaultSeverity: 'medium',
  detect(ctx) {
    const extra = ctx.lists.unexpectedExecutablePaths;
    const drafts: DetectionDraft[] = [];
    for (const inv of ctx.hostInventories) {
      const evidenceRefs = inventoryEvidence(inv);
      for (const entry of inv.persistence) {
        const target = entry.path ?? entry.command;
        if (!target) continue;
        if (!isSuspectLocation(target, extra)) continue;
        drafts.push({
          affected: deviceAffected(inv.deviceId),
          salientKey: `persistence:${entry.kind}:${entry.name.toLowerCase()}`,
          title: `Unusual ${entry.kind} persistence entry: ${entry.name}`,
          evidenceRefs,
          contributingProvenanceRows: [],
          baseConfidence: 0.55,
          explanation: `The ${entry.kind} entry "${entry.name}" launches from a temporary / unusual location ("${target}"), where persistence rarely belongs.`,
          verificationSteps: [
            'Confirm the persistence entry is expected and points at a legitimate binary.',
            'Check who created the entry and when.',
          ],
        });
      }
    }
    return drafts;
  },
};

export const processPersistenceRules: readonly Rule[] = [
  unapprovedRemoteAccessRule,
  unusualPersistenceRule,
];
