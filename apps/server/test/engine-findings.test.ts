import { describe, expect, it } from 'vitest';
import { reconcileFindings, type FindingStatus, type Operation } from '@netplan/domain';
import { createTestEngine, opId } from './helpers.js';

function setStatus(
  projectId: Operation['projectId'],
  fingerprint: string,
  status: FindingStatus,
): Operation {
  return {
    id: opId(),
    projectId,
    kind: 'SetFindingStatus',
    fingerprint,
    status,
    // `previousStatus` is a client placeholder; applyOne enriches it from the DB.
    previousStatus: 'new',
  };
}

describe('M2 finding disposition through the Operation log (ADR-0023)', () => {
  it('creates a disposition row on first status change and returns it in state', () => {
    const { engine, project } = createTestEngine();
    engine.applyOperation(setStatus(project.id, 'fp-abc', 'falsePositive'));

    const dispositions = engine.getState(project.id).findingDispositions;
    expect(dispositions).toHaveLength(1);
    expect(dispositions[0]?.fingerprint).toBe('fp-abc');
    expect(dispositions[0]?.status).toBe('falsePositive');
  });

  it('records the disposition change in the audit log and is undoable', () => {
    const { engine, project } = createTestEngine();
    engine.applyOperation(setStatus(project.id, 'fp-abc', 'falsePositive'));

    const log = engine.getLog(project.id);
    expect(log).toHaveLength(1);
    expect(log[0]?.kind).toBe('SetFindingStatus');

    const undo = engine.undo(project.id);
    expect(undo).not.toBeNull();
    // Undo reverts to the pre-op status (`new`); the row is retained, not deleted.
    const dispositions = engine.getState(project.id).findingDispositions;
    expect(dispositions[0]?.status).toBe('new');
    expect(engine.getLog(project.id).map((e) => e.role)).toEqual(['do', 'undo']);
  });

  it('a falsePositive disposition survives a re-analysis of the same graph', () => {
    const { engine, project } = createTestEngine();
    const fingerprint = 'fp-stable';
    engine.applyOperation(setStatus(project.id, fingerprint, 'falsePositive'));

    // A later analysis run re-detects the same fingerprint (pure recompute).
    const detections = [
      {
        fingerprint,
        ruleId: 'r',
        ruleVersion: '1',
        configHash: 'h',
        category: 'c',
        title: 't',
        affected: null,
        evidenceRefs: [],
        contributingProvenanceRows: [],
        citedBaselineId: null,
        citedBaselineVersion: null,
        severity: 'high' as const,
        confidence: 0.5,
        explanation: 'e',
        verificationSteps: [],
      },
    ];
    const views = reconcileFindings(detections, engine.getState(project.id).findingDispositions);
    expect(views[0]?.status).toBe('falsePositive');
  });

  it('updates in place on a second status change (no duplicate rows)', () => {
    const { engine, project } = createTestEngine();
    engine.applyOperation(setStatus(project.id, 'fp-abc', 'acknowledged'));
    engine.applyOperation(setStatus(project.id, 'fp-abc', 'resolved'));

    const dispositions = engine.getState(project.id).findingDispositions;
    expect(dispositions).toHaveLength(1);
    expect(dispositions[0]?.status).toBe('resolved');
  });

  it('persists a note through SetFindingNote and inverts it on undo', () => {
    const { engine, project } = createTestEngine();
    engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'SetFindingNote',
      fingerprint: 'fp-note',
      note: 'looked benign on review',
      previousNote: '',
    });
    expect(engine.getState(project.id).findingDispositions[0]?.notes).toBe(
      'looked benign on review',
    );

    engine.undo(project.id);
    expect(engine.getState(project.id).findingDispositions[0]?.notes).toBe('');
  });

  it('round-trips a disposition through undo/redo to byte-identical state', () => {
    const { engine, project } = createTestEngine();
    engine.applyOperation(setStatus(project.id, 'fp-abc', 'acknowledged'));
    const after = JSON.stringify(engine.getState(project.id));
    engine.undo(project.id);
    engine.redo(project.id);
    expect(JSON.stringify(engine.getState(project.id))).toBe(after);
  });
});
