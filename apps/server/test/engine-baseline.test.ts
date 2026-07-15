import { describe, expect, it } from 'vitest';
import {
  makeBundle,
  netplanBundleSchema,
  validateBaselines,
  type Baseline,
  type Operation,
} from '@netplan/domain';
import { makeBaseline, makeDevice, makeSite, makeZone } from '@netplan/domain/fixtures';
import { createDb } from '../src/db/index.js';
import { createEngine } from '../src/engine/store.js';
import { createTestEngine, createDeviceOp, opId } from './helpers.js';

function createBaselineOp(projectId: Operation['projectId'], baseline: Baseline): Operation {
  return {
    id: opId(),
    projectId,
    kind: 'CreateEntity',
    payload: { entityType: 'baseline', entity: baseline },
  };
}

describe('M4 Baseline through the Operation log (ADR-0025, ADR-0010)', () => {
  it('creates a Baseline scoped to a Zone and reads it back in state', () => {
    const { engine, project } = createTestEngine();
    const site = makeSite(project.id);
    const zone = makeZone(site);
    engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'site', entity: site },
    });
    engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'CreateEntity',
      payload: { entityType: 'zone', entity: zone },
    });

    const baseline = makeBaseline(project.id, { kind: 'zone', id: zone.id });
    engine.applyOperation(createBaselineOp(project.id, baseline));

    const stored = engine.getState(project.id).baselines;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.scope).toEqual({ kind: 'zone', id: zone.id });
  });

  it('rejects a Baseline whose scope references a missing object', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id); // never created
    const baseline = makeBaseline(project.id, { kind: 'device', id: device.id });
    expect(() => engine.applyOperation(createBaselineOp(project.id, baseline))).toThrow();
  });

  it('edits a Baseline through SetField and undoes the edit', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);
    engine.applyOperation(createDeviceOp(project, device));
    const baseline = makeBaseline(project.id, { kind: 'device', id: device.id }, { version: 1 });
    engine.applyOperation(createBaselineOp(project.id, baseline));

    engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'SetField',
      entityType: 'baseline',
      entityId: baseline.id,
      field: 'version',
      value: 2,
      previousValue: 1,
    });
    expect(engine.getState(project.id).baselines[0]?.version).toBe(2);

    engine.undo(project.id);
    expect(engine.getState(project.id).baselines[0]?.version).toBe(1);
  });

  it('retains a Baseline and surfaces an orphaned reference when its Device is deleted', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);
    engine.applyOperation(createDeviceOp(project, device));
    const baseline = makeBaseline(project.id, { kind: 'device', id: device.id });
    engine.applyOperation(createBaselineOp(project.id, baseline));

    // Deleting the referenced Device is allowed; the orphan is surfaced, not blocked.
    engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'DeleteEntity',
      payload: { entityType: 'device', entity: device },
    });

    const state = engine.getState(project.id);
    expect(state.baselines).toHaveLength(1);
    const warnings = validateBaselines(state);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toBe('orphaned');
  });

  it('round-trips a Baseline through the .netplan bundle', () => {
    const { engine, project } = createTestEngine();
    const device = makeDevice(project.id);
    engine.applyOperation(createDeviceOp(project, device));
    const baseline = makeBaseline(project.id, { kind: 'device', id: device.id });
    engine.applyOperation(createBaselineOp(project.id, baseline));

    const bundle = makeBundle(engine.getState(project.id), '2026-07-15T00:00:00.000Z', {
      evidence: [],
    });
    const parsed = netplanBundleSchema.parse(bundle);

    // Re-import into a fresh engine and confirm the Baseline survived.
    const { db } = createDb(':memory:');
    const fresh = createEngine(db);
    fresh.importState(parsed.project);
    expect(fresh.getState(project.id).baselines).toEqual([baseline]);
  });
});
