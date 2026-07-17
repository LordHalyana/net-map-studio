import { describe, expect, it } from 'vitest';
import { makeDevice, makeFlow } from '@netplan/domain/fixtures';
import type { Device, Flow, Project } from '@netplan/domain';
import { OperationError, type Engine } from '../src/engine/store.js';
import { createDeviceOp, createTestEngine, opId } from './helpers.js';

/**
 * queryFlows (#82): the engine's paged Flow read — endpoint matching, time
 * filters and slicing happen behind the interface, unit-testable without HTTP.
 */

function createFlowOp(project: Project, flow: Flow) {
  return {
    id: opId(),
    projectId: project.id,
    kind: 'CreateEntity' as const,
    payload: { entityType: 'flow' as const, entity: flow },
  };
}

function seedDevices(engine: Engine, project: Project, count: number): Device[] {
  return Array.from({ length: count }, (_, i) => {
    const device = makeDevice(project.id, { name: `host-${i}` });
    engine.applyOperation(createDeviceOp(project, device));
    return device;
  });
}

describe('queryFlows — paged Flow reads behind the engine (#82)', () => {
  it('returns a page ordered by id with the unfiltered total', () => {
    const { engine, project } = createTestEngine();
    const flowIds = Array.from({ length: 5 }, () => {
      const flow = makeFlow(project.id);
      engine.applyOperation(createFlowOp(project, flow));
      return flow.id;
    }).sort();

    const page = engine.queryFlows(project.id, { limit: 3, offset: 0 });

    expect(page.total).toBe(5);
    expect(page.flows.map((f) => f.id)).toEqual(flowIds.slice(0, 3));
  });

  it('offset continues where the previous page ended', () => {
    const { engine, project } = createTestEngine();
    for (let i = 0; i < 5; i++) engine.applyOperation(createFlowOp(project, makeFlow(project.id)));

    const first = engine.queryFlows(project.id, { limit: 2, offset: 0 });
    const second = engine.queryFlows(project.id, { limit: 2, offset: 2 });

    expect(second.total).toBe(5);
    const seen = new Set([...first.flows, ...second.flows].map((f) => f.id));
    expect(seen.size).toBe(4);
  });

  it('a zero limit returns no flows but still counts the total', () => {
    const { engine, project } = createTestEngine();
    engine.applyOperation(createFlowOp(project, makeFlow(project.id)));

    const page = engine.queryFlows(project.id, { limit: 0 });

    expect(page.flows).toEqual([]);
    expect(page.total).toBe(1);
  });

  it('matches an endpoint as flow source, destination, or external literal', () => {
    const { engine, project } = createTestEngine();
    const [a, b, c] = seedDevices(engine, project, 3);
    const asSource = makeFlow(project.id, {
      source: { kind: 'device', id: a!.id },
      destination: { kind: 'device', id: b!.id },
    });
    const asDestination = makeFlow(project.id, {
      source: { kind: 'device', id: c!.id },
      destination: { kind: 'device', id: a!.id },
    });
    const external = makeFlow(project.id, {
      source: { kind: 'device', id: b!.id },
      destination: { kind: 'external', value: '203.0.113.9' },
    });
    for (const flow of [asSource, asDestination, external]) {
      engine.applyOperation(createFlowOp(project, flow));
    }

    const byDevice = engine.queryFlows(project.id, { endpoint: a!.id, limit: 10 });
    expect(byDevice.total).toBe(2);
    expect(byDevice.flows.map((f) => f.id).sort()).toEqual([asSource.id, asDestination.id].sort());

    const byExternal = engine.queryFlows(project.id, { endpoint: '203.0.113.9', limit: 10 });
    expect(byExternal.flows.map((f) => f.id)).toEqual([external.id]);
  });

  it('an endpoint id never matches an external literal of the same text', () => {
    const { engine, project } = createTestEngine();
    const flow = makeFlow(project.id, {
      source: { kind: 'external', value: '10.0.0.1' },
      destination: { kind: 'external', value: '10.0.0.2' },
    });
    engine.applyOperation(createFlowOp(project, flow));

    expect(engine.queryFlows(project.id, { endpoint: '10.0.0.9', limit: 10 }).total).toBe(0);
    expect(engine.queryFlows(project.id, { endpoint: '10.0.0.1', limit: 10 }).total).toBe(1);
  });

  it('filters by service port', () => {
    const { engine, project } = createTestEngine();
    const https = makeFlow(project.id, { port: 443 });
    engine.applyOperation(createFlowOp(project, https));
    engine.applyOperation(createFlowOp(project, makeFlow(project.id, { port: 22 })));

    const page = engine.queryFlows(project.id, { service: 443, limit: 10 });

    expect(page.flows.map((f) => f.id)).toEqual([https.id]);
    expect(page.total).toBe(1);
  });

  it('since keeps flows still seen at the bound; until keeps flows first seen by it', () => {
    const { engine, project } = createTestEngine();
    const early = makeFlow(project.id, {
      firstSeen: '2026-07-01T00:00:00.000Z',
      lastSeen: '2026-07-02T00:00:00.000Z',
    });
    const late = makeFlow(project.id, {
      firstSeen: '2026-07-10T00:00:00.000Z',
      lastSeen: '2026-07-15T00:00:00.000Z',
    });
    engine.applyOperation(createFlowOp(project, early));
    engine.applyOperation(createFlowOp(project, late));

    const since = engine.queryFlows(project.id, { since: '2026-07-05T00:00:00.000Z', limit: 10 });
    expect(since.flows.map((f) => f.id)).toEqual([late.id]);

    const until = engine.queryFlows(project.id, { until: '2026-07-05T00:00:00.000Z', limit: 10 });
    expect(until.flows.map((f) => f.id)).toEqual([early.id]);
  });

  it('total counts the filtered set, not the page', () => {
    const { engine, project } = createTestEngine();
    for (let i = 0; i < 4; i++) {
      engine.applyOperation(createFlowOp(project, makeFlow(project.id, { port: 443 })));
    }
    engine.applyOperation(createFlowOp(project, makeFlow(project.id, { port: 22 })));

    const page = engine.queryFlows(project.id, { service: 443, limit: 2 });

    expect(page.flows).toHaveLength(2);
    expect(page.total).toBe(4);
  });

  it('treats empty-string filters as absent, like the pre-#82 route', () => {
    const { engine, project } = createTestEngine();
    engine.applyOperation(createFlowOp(project, makeFlow(project.id)));

    const page = engine.queryFlows(project.id, { endpoint: '', since: '', until: '', limit: 10 });

    expect(page.total).toBe(1);
  });

  it('rejects an unknown project', () => {
    const { engine } = createTestEngine();
    expect(() => engine.queryFlows('missing', { limit: 10 })).toThrow(OperationError);
  });
});

describe('getState omitFlows (#82)', () => {
  it('skips the flow load while everything else stays intact', () => {
    const { engine, project } = createTestEngine();
    seedDevices(engine, project, 2);
    engine.applyOperation(createFlowOp(project, makeFlow(project.id)));

    const state = engine.getState(project.id, { omitFlows: true });

    expect(state.flows).toEqual([]);
    expect(state.devices).toHaveLength(2);
    expect(engine.getState(project.id).flows).toHaveLength(1);
  });
});
