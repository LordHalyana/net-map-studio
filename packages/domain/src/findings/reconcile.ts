import type { FindingId } from '../ids.js';
import {
  INITIAL_FINDING_STATUS,
  type FindingDisposition,
  type FindingStatus,
} from './disposition.js';
import type { DetectionRecord } from './rule.js';

/**
 * A Finding as the UI sees it: the derived detection joined to its persisted
 * disposition by Fingerprint (ADR-0023).
 *
 * - `detection` is null for a **stale** finding — one whose disposition
 *   survives but whose evidence has disappeared from the latest run. We retain
 *   it (never silently delete an analyst's decision) and flag it.
 */
export interface FindingView {
  fingerprint: string;
  detection: DetectionRecord | null;
  status: FindingStatus;
  notes: string;
  /** True when a disposition exists but the current run no longer detects it. */
  stale: boolean;
  /** The persisted disposition's id, or null when the finding is still `new`. */
  dispositionId: FindingId | null;
}

/**
 * Join this run's detections to the stored dispositions by Fingerprint:
 *
 * - an **unchanged** fingerprint keeps its disposition (a `falsePositive`
 *   stays `falsePositive` across re-runs);
 * - a **new** fingerprint with no stored disposition starts at `new`;
 * - a stored disposition whose fingerprint is **absent** from this run is
 *   retained and marked `stale` (resolved-by-evidence), never dropped.
 *
 * Pure and idempotent — this is the derived half of a Finding (ADR-0023).
 */
export function reconcileFindings(
  detections: readonly DetectionRecord[],
  dispositions: readonly FindingDisposition[],
): FindingView[] {
  const byFingerprint = new Map(dispositions.map((d) => [d.fingerprint, d] as const));
  const detected = new Set<string>();
  const views: FindingView[] = [];

  for (const detection of detections) {
    detected.add(detection.fingerprint);
    const disposition = byFingerprint.get(detection.fingerprint);
    views.push({
      fingerprint: detection.fingerprint,
      detection,
      status: disposition?.status ?? INITIAL_FINDING_STATUS,
      notes: disposition?.notes ?? '',
      stale: false,
      dispositionId: disposition?.id ?? null,
    });
  }

  for (const disposition of dispositions) {
    if (detected.has(disposition.fingerprint)) continue;
    views.push({
      fingerprint: disposition.fingerprint,
      detection: null,
      status: disposition.status,
      notes: disposition.notes,
      stale: true,
      dispositionId: disposition.id,
    });
  }

  return views;
}
