import type { DeviceId } from '../../ids.js';
import type { Rule, DetectionDraft } from '../rule.js';
import {
  basename,
  extensions,
  includesInsensitive,
  inventoryEvidence,
  pathCandidates,
  type PathCandidate,
} from './helpers.js';

/**
 * M5 — filename / path family (design §3.8). Four conservative, high-signal
 * detections over the per-Device security inventory (M5 inputs). Each is its
 * own Rule so operators can enable/disable and tune it independently (ADR-0024).
 * Absent file data yields no findings — a silent gap, surfaced as coverage (M9),
 * never a false clean.
 */

const EXECUTABLE_EXTS = new Set([
  'exe',
  'scr',
  'bat',
  'cmd',
  'com',
  'pif',
  'js',
  'jse',
  'vbs',
  'vbe',
  'ps1',
  'jar',
  'msi',
  'hta',
]);
const DECOY_EXTS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'txt',
  'csv',
  'zip',
  'rtf',
]);
/** Locations an executable should not normally run from. */
const DEFAULT_UNEXPECTED_PATHS = [
  '\\temp\\',
  '/tmp/',
  '\\tmp\\',
  '\\downloads\\',
  '/downloads/',
  'appdata\\local\\temp',
  '\\$recycle',
  '/dev/shm/',
  '\\programdata\\temp',
];

function isExecutable(filename: string): boolean {
  const exts = extensions(filename);
  const last = exts[exts.length - 1];
  return last !== undefined && EXECUTABLE_EXTS.has(last);
}

function draftFor(
  deviceId: DeviceId,
  evidenceRefs: ReturnType<typeof inventoryEvidence>,
  ruleKey: string,
  candidate: PathCandidate,
  title: string,
  explanation: string,
  verificationSteps: string[],
  baseConfidence: number,
): DetectionDraft {
  return {
    affected: { kind: 'device', id: deviceId },
    salientKey: `${ruleKey}:${candidate.path.toLowerCase()}`,
    title,
    evidenceRefs,
    contributingProvenanceRows: [],
    baseConfidence,
    explanation,
    verificationSteps,
  };
}

export const suspiciousFilenameRule: Rule = {
  id: 'file.suspiciousName',
  ruleVersion: '1.0.0',
  category: 'suspicious filename or path',
  defaultSeverity: 'medium',
  detect(ctx) {
    const names = ctx.lists.suspiciousFilenames;
    const segments = ctx.lists.suspiciousPathSegments;
    if (names.length === 0 && segments.length === 0) return [];
    const drafts: DetectionDraft[] = [];
    for (const inv of ctx.hostInventories) {
      const evidenceRefs = inventoryEvidence(inv);
      for (const candidate of pathCandidates(inv)) {
        const nameHit = names.some((n) => candidate.filename.toLowerCase() === n.toLowerCase());
        const pathHit = segments.some((s) => includesInsensitive(candidate.path, s));
        if (!nameHit && !pathHit) continue;
        drafts.push(
          draftFor(
            inv.deviceId,
            evidenceRefs,
            'file.suspiciousName',
            candidate,
            `Suspicious ${candidate.source}: ${candidate.filename}`,
            `"${candidate.path}" matches an operator suspicious-filename / path indicator.`,
            ['Confirm the file is expected on this device and check its origin.'],
            0.5,
          ),
        );
      }
    }
    return drafts;
  },
};

export const masqueradeRule: Rule = {
  id: 'file.masquerade',
  ruleVersion: '1.0.0',
  category: 'masquerading or double-extension',
  defaultSeverity: 'high',
  detect(ctx) {
    const drafts: DetectionDraft[] = [];
    for (const inv of ctx.hostInventories) {
      const evidenceRefs = inventoryEvidence(inv);
      for (const candidate of pathCandidates(inv)) {
        const exts = extensions(candidate.filename);
        if (exts.length < 2) continue;
        const last = exts[exts.length - 1];
        const prior = exts[exts.length - 2];
        if (last && prior && EXECUTABLE_EXTS.has(last) && DECOY_EXTS.has(prior)) {
          drafts.push(
            draftFor(
              inv.deviceId,
              evidenceRefs,
              'file.masquerade',
              candidate,
              `Double-extension executable: ${candidate.filename}`,
              `"${candidate.filename}" hides an executable (.${last}) behind a document extension (.${prior}) — a common masquerading pattern.`,
              ['Treat as untrusted; inspect the file and its delivery path before opening.'],
              0.8,
            ),
          );
        }
      }
    }
    return drafts;
  },
};

export const unexpectedLocationRule: Rule = {
  id: 'file.unexpectedLocation',
  ruleVersion: '1.0.0',
  category: 'unexpected executable location',
  defaultSeverity: 'medium',
  detect(ctx) {
    const locations = [...DEFAULT_UNEXPECTED_PATHS, ...ctx.lists.unexpectedExecutablePaths];
    const drafts: DetectionDraft[] = [];
    for (const inv of ctx.hostInventories) {
      const evidenceRefs = inventoryEvidence(inv);
      for (const candidate of pathCandidates(inv)) {
        if (!isExecutable(candidate.filename)) continue;
        if (!locations.some((loc) => includesInsensitive(candidate.path, loc))) continue;
        drafts.push(
          draftFor(
            inv.deviceId,
            evidenceRefs,
            'file.unexpectedLocation',
            candidate,
            `Executable in an unexpected location: ${candidate.filename}`,
            `"${candidate.path}" runs an executable from a temporary / download location, where legitimate software rarely lives.`,
            ['Verify why an executable is present in this location and who placed it.'],
            0.5,
          ),
        );
      }
    }
    return drafts;
  },
};

export const knownIndicatorRule: Rule = {
  id: 'file.knownIndicator',
  ruleVersion: '1.0.0',
  category: 'known indicator match',
  defaultSeverity: 'critical',
  detect(ctx) {
    const hashes = ctx.lists.knownFileHashes.map((h) => h.toLowerCase());
    if (hashes.length === 0) return [];
    const drafts: DetectionDraft[] = [];
    for (const inv of ctx.hostInventories) {
      const evidenceRefs = inventoryEvidence(inv);
      for (const candidate of pathCandidates(inv)) {
        if (!candidate.sha256 || !hashes.includes(candidate.sha256.toLowerCase())) continue;
        drafts.push(
          draftFor(
            inv.deviceId,
            evidenceRefs,
            'file.knownIndicator',
            candidate,
            `Known indicator match: ${basename(candidate.path)}`,
            `"${candidate.path}" matches a hash on the local operator indicator (IoC) list.`,
            ['Isolate and triage the device; correlate the indicator across other devices (M10).'],
            0.9,
          ),
        );
      }
    }
    return drafts;
  },
};

export const filenamePathRules: readonly Rule[] = [
  suspiciousFilenameRule,
  masqueradeRule,
  unexpectedLocationRule,
  knownIndicatorRule,
];
