import { describe, expect, it } from 'vitest';
import {
  changeSetIdSchema,
  newId,
  type ChangeSet,
  type EntityPayload,
  type Flow,
  type Operation,
  type PolicyRule,
  type Project,
  type Site,
  type Zone,
} from '@netplan/domain';
import {
  makeDevice,
  makeFlow,
  makeNetwork,
  makePolicyRule,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';
import { OperationError } from '../src/engine/store.js';
import { createTestEngine, opId } from './helpers.js';

function createOp(project: Project, payload: EntityPayload): Operation {
  return { id: opId(), projectId: project.id, kind: 'CreateEntity', payload };
}

function deleteOp(project: Project, payload: EntityPayload): Operation {
  return { id: opId(), projectId: project.id, kind: 'DeleteEntity', payload };
}

/** Mirrors the op order of the client's deleteZoneChangeSet/deleteSiteChangeSet
 *  (apps/web/src/state/ops.ts): unparent devices, drop zone-targeting rules and
 *  flows, then the zone rows, then (site variant) the site row. */
function cascade(
  project: Project,
  parts: {
    unparent?: { deviceId: string; zoneId: string }[];
    rules?: PolicyRule[];
    flows?: Flow[];
    zones?: Zone[];
    site?: Site;
  },
): ChangeSet {
  const ops: Operation[] = [];
  for (const u of parts.unparent ?? []) {
    ops.push({
      id: opId(),
      projectId: project.id,
      kind: 'SetContainment',
      deviceId: u.deviceId,
      zoneId: null,
      previousZoneId: u.zoneId,
    } as Operation);
  }
  for (const rule of parts.rules ?? []) {
    ops.push({
      id: opId(),
      projectId: project.id,
      kind: 'DeletePolicyRule',
      ruleId: rule.id,
      snapshot: rule,
    } as Operation);
  }
  for (const flow of parts.flows ?? []) {
    ops.push(deleteOp(project, { entityType: 'flow', entity: flow }));
  }
  for (const zone of parts.zones ?? []) {
    ops.push(deleteOp(project, { entityType: 'zone', entity: zone }));
  }
  if (parts.site) ops.push(deleteOp(project, { entityType: 'site', entity: parts.site }));
  return {
    id: newId(changeSetIdSchema),
    projectId: project.id,
    label: 'Delete zone cascade',
    operations: ops,
  };
}

describe('Zone/Site delete cascade (ui-polish M3, ADR-0012/0013)', () => {
  it('rejects a bare zone delete while a device is still contained', () => {
    const { engine, project } = createTestEngine();
    const site = makeSite(project.id);
    const zone = makeZone(site);
    const device = makeDevice(project.id, { zoneId: zone.id });
    engine.applyOperation(createOp(project, { entityType: 'site', entity: site }));
    engine.applyOperation(createOp(project, { entityType: 'zone', entity: zone }));
    engine.applyOperation(createOp(project, { entityType: 'device', entity: device }));

    expect(() =>
      engine.applyOperation(deleteOp(project, { entityType: 'zone', entity: zone })),
    ).toThrow(OperationError);
    expect(engine.getState(project.id).zones).toHaveLength(1);
  });

  it('rejects a bare site delete while a zone still references it', () => {
    const { engine, project } = createTestEngine();
    const site = makeSite(project.id);
    const zone = makeZone(site);
    engine.applyOperation(createOp(project, { entityType: 'site', entity: site }));
    engine.applyOperation(createOp(project, { entityType: 'zone', entity: zone }));

    expect(() =>
      engine.applyOperation(deleteOp(project, { entityType: 'site', entity: site })),
    ).toThrow(OperationError);
    expect(engine.getState(project.id).sites).toHaveLength(1);
  });

  it('rejects a bare zone delete while a PolicyRule targets the zone', () => {
    const { engine, project } = createTestEngine();
    const site = makeSite(project.id);
    const zone = makeZone(site);
    const scratch = makeNetwork(project.id);
    const rule = makePolicyRule(scratch, scratch, {
      source: { kind: 'zone', id: zone.id },
      destination: { kind: 'zone', id: zone.id },
    });
    engine.applyOperation(createOp(project, { entityType: 'site', entity: site }));
    engine.applyOperation(createOp(project, { entityType: 'zone', entity: zone }));
    engine.applyOperation({
      id: opId(),
      projectId: project.id,
      kind: 'CreatePolicyRule',
      rule,
    });

    expect(() =>
      engine.applyOperation(deleteOp(project, { entityType: 'zone', entity: zone })),
    ).toThrow(OperationError);
    expect(engine.getState(project.id).zones).toHaveLength(1);
  });

  it('applies the ordered cascade atomically and undo restores everything', () => {
    const { engine, project } = createTestEngine();
    const site = makeSite(project.id);
    const zone = makeZone(site);
    const device = makeDevice(project.id, { zoneId: zone.id });
    const scratch = makeNetwork(project.id);
    // both endpoints hit the same zone — the client dedupes to ONE DeletePolicyRule
    const rule = makePolicyRule(scratch, scratch, {
      source: { kind: 'zone', id: zone.id },
      destination: { kind: 'zone', id: zone.id },
    });
    const flow = makeFlow(project.id, { source: { kind: 'zone', id: zone.id } });
    engine.applyOperation(createOp(project, { entityType: 'site', entity: site }));
    engine.applyOperation(createOp(project, { entityType: 'zone', entity: zone }));
    engine.applyOperation(createOp(project, { entityType: 'device', entity: device }));
    engine.applyOperation({ id: opId(), projectId: project.id, kind: 'CreatePolicyRule', rule });
    engine.applyOperation(createOp(project, { entityType: 'flow', entity: flow }));

    engine.applyChangeSet(
      cascade(project, {
        unparent: [{ deviceId: device.id, zoneId: zone.id }],
        rules: [rule],
        flows: [flow],
        zones: [zone],
      }),
    );

    let state = engine.getState(project.id);
    expect(state.zones).toHaveLength(0);
    expect(state.devices[0]?.zoneId).toBeNull();
    expect(state.policyRules).toHaveLength(0);
    expect(state.flows).toHaveLength(0);
    expect(state.sites).toHaveLength(1); // zone-only delete leaves the site

    engine.undo(project.id);
    state = engine.getState(project.id);
    expect(state.zones).toHaveLength(1);
    expect(state.devices[0]?.zoneId).toBe(zone.id);
    expect(state.policyRules).toHaveLength(1);
    expect(state.flows).toHaveLength(1);
  });

  it('site cascade deletes its zones, unparents their devices, then the site', () => {
    const { engine, project } = createTestEngine();
    const site = makeSite(project.id);
    const zoneA = makeZone(site);
    const zoneB = makeZone(site, { name: 'rack-b' });
    const deviceA = makeDevice(project.id, { zoneId: zoneA.id });
    const deviceB = makeDevice(project.id, { name: 'srv-b', zoneId: zoneB.id });
    engine.applyOperation(createOp(project, { entityType: 'site', entity: site }));
    engine.applyOperation(createOp(project, { entityType: 'zone', entity: zoneA }));
    engine.applyOperation(createOp(project, { entityType: 'zone', entity: zoneB }));
    engine.applyOperation(createOp(project, { entityType: 'device', entity: deviceA }));
    engine.applyOperation(createOp(project, { entityType: 'device', entity: deviceB }));

    engine.applyChangeSet(
      cascade(project, {
        unparent: [
          { deviceId: deviceA.id, zoneId: zoneA.id },
          { deviceId: deviceB.id, zoneId: zoneB.id },
        ],
        zones: [zoneA, zoneB],
        site,
      }),
    );

    let state = engine.getState(project.id);
    expect(state.sites).toHaveLength(0);
    expect(state.zones).toHaveLength(0);
    expect(state.devices).toHaveLength(2);
    expect(state.devices.every((d) => d.zoneId === null)).toBe(true);

    engine.undo(project.id);
    state = engine.getState(project.id);
    expect(state.sites).toHaveLength(1);
    expect(state.zones).toHaveLength(2);
    expect(state.devices.find((d) => d.id === deviceA.id)?.zoneId).toBe(zoneA.id);
    expect(state.devices.find((d) => d.id === deviceB.id)?.zoneId).toBe(zoneB.id);
  });
});
