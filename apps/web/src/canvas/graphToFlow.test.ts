import { describe, expect, it } from 'vitest';
import { projectStateSchema, type ProjectState } from '@netplan/domain';
import {
  makeDevice,
  makeInterface,
  makeNetwork,
  makePolicyRule,
  makeProject,
  makeSite,
  makeZone,
} from '@netplan/domain/fixtures';
import { footprints, type Footprints } from './footprints';
import { graphToFlow, type FlowOptions } from './graphToFlow';
import type { Node } from '@xyflow/react';

function makeOptions(overrides: Partial<FlowOptions> = {}): FlowOptions {
  return {
    logical: true,
    physical: true,
    observed: false,
    identities: false,
    mode: 'asIs',
    provenance: [],
    collapsedSites: [],
    collapsedZones: [],
    rules: false,
    findingsLayer: false,
    openFindingsByDevice: new Map(),
    ...overrides,
  };
}

/**
 * Representative scene for the footprint agreement test (#78): full cards, a
 * compact leaf, network-nodes, Sites and Zones with and without declared sizes.
 */
function makeScene() {
  const project = makeProject();
  const pid = project.id;
  const sizedSite = makeSite(pid, { size: { width: 700, height: 500 } });
  const defaultSite = makeSite(pid, { name: 'Annex', position: { x: 900, y: 0 } });
  const sizedZone = makeZone(sizedSite, { size: { width: 320, height: 240 } });
  const defaultZone = makeZone(sizedSite, { name: 'Lobby', position: { x: 360, y: 0 } });

  const vlan = makeNetwork(pid);
  const leaf = makeDevice(pid, { name: 'leaf', deviceType: 'workstation' });
  const zoned = makeDevice(pid, { name: 'zoned', deviceType: 'server', zoneId: sizedZone.id });
  const filler = Array.from({ length: 7 }, (_, i) =>
    makeDevice(pid, { name: `filler-${i}`, deviceType: 'server' }),
  );

  const state: ProjectState = projectStateSchema.parse({
    project,
    sites: [sizedSite, defaultSite],
    zones: [sizedZone, defaultZone],
    devices: [leaf, zoned, ...filler],
    interfaces: [makeInterface(leaf, { networkId: vlan.id })],
    addresses: [],
    networks: [vlan],
    links: [],
    services: [],
    policyRules: [],
  });
  return { state, sizedSite, defaultSite, sizedZone, defaultZone, leaf, vlan };
}

/** The dimensions a projected node advertises, whichever channel carries them. */
function emittedSize(node: Node): { width: unknown; height: unknown } {
  if (node.type === 'site' || node.type === 'zone') {
    return { width: node.style?.width, height: node.style?.height };
  }
  return { width: node.initialWidth, height: node.initialHeight };
}

function resolverSize(node: Node, state: ProjectState, fp: Footprints) {
  switch (node.type) {
    case 'site': {
      const site = state.sites.find((s) => s.id === node.id);
      if (!site) throw new Error(`no site ${node.id}`);
      const { width, height } = fp.siteRect(site);
      return { width, height };
    }
    case 'zone': {
      const zone = state.zones.find((z) => z.id === node.id);
      if (!zone) throw new Error(`no zone ${node.id}`);
      return fp.zoneSize(zone);
    }
    case 'device':
      return fp.device(node.id);
    case 'network':
      return fp.network();
    default:
      throw new Error(`unexpected node type ${node.type}`);
  }
}

/**
 * Callout anchors honour Containment (#87): a zone-contained Device stores a
 * zone-relative position (ADR-0013), so anchors, the scene centroid and the
 * collision rects must all convert to absolute canvas coordinates.
 */
describe('graphToFlow policy-rule callout containment (#87)', () => {
  /** Two Sites far apart, each holding one Zone with one contained Device. */
  function makeContainedScene() {
    const project = makeProject();
    const pid = project.id;
    const siteA = makeSite(pid, {
      position: { x: 1000, y: 500 },
      size: { width: 700, height: 500 },
    });
    const siteB = makeSite(pid, {
      name: 'Annex',
      position: { x: 2000, y: 500 },
      size: { width: 700, height: 500 },
    });
    const zoneA = makeZone(siteA, { position: { x: 200, y: 100 } });
    const zoneB = makeZone(siteB, { name: 'Lab', position: { x: 100, y: 100 } });
    const vlan = makeNetwork(pid);
    // absolute positions: a = (1250, 640), b = (2200, 640)
    const a = makeDevice(pid, { name: 'a', zoneId: zoneA.id, position: { x: 50, y: 40 } });
    const b = makeDevice(pid, { name: 'b', zoneId: zoneB.id, position: { x: 100, y: 40 } });
    const base = {
      project,
      sites: [siteA, siteB],
      zones: [zoneA, zoneB],
      devices: [a, b],
      interfaces: [],
      addresses: [],
      networks: [vlan],
      links: [],
      services: [],
    };
    return { base, vlan, a, b };
  }

  it('anchors a single-endpoint callout beside the absolute device position', () => {
    const { base, vlan, a } = makeContainedScene();
    // the network source never renders (logical off), so the callout falls
    // back to the lone device anchor: right edge of the card, 10 up
    const rule = makePolicyRule(vlan, vlan, { destination: { kind: 'device', id: a.id } });
    const state = projectStateSchema.parse({ ...base, policyRules: [rule] });
    const { nodes } = graphToFlow(
      state,
      makeOptions({ logical: false, rules: true, mode: 'toBe' }),
    );
    const callout = nodes.find((n) => n.type === 'policyRuleCallout');
    const fp = footprints(state);
    expect(callout?.position).toEqual({ x: 1250 + fp.device(a.id).width, y: 640 - 10 });
  });

  it('offsets a device-to-device callout from the absolute midpoint', () => {
    const { base, vlan, a, b } = makeContainedScene();
    const rule = makePolicyRule(vlan, vlan, {
      source: { kind: 'device', id: a.id },
      destination: { kind: 'device', id: b.id },
    });
    const state = projectStateSchema.parse({ ...base, policyRules: [rule] });
    const { nodes } = graphToFlow(
      state,
      makeOptions({ logical: false, rules: true, mode: 'toBe' }),
    );
    const callout = nodes.find((n) => n.type === 'policyRuleCallout');
    // midpoint of the absolute anchors (1725, 640) plus CALLOUT_OFFSET along
    // the perpendicular; both devices sit clear of the card, so no nudge
    expect(callout?.position).toEqual({ x: 1725, y: 640 + 110 });
  });
});

/**
 * The agreement test (#78): every node the projection emits carries exactly
 * the dimensions the footprint resolver answers for it, so footprint drift
 * between layout and render is a CI failure instead of a visual bug report.
 */
describe('graphToFlow footprint agreement (#78)', () => {
  it('emits every expanded node with the resolver dimensions', () => {
    const { state, leaf } = makeScene();
    const fp = footprints(state);
    const { nodes } = graphToFlow(state, makeOptions());
    expect(nodes.length).toBeGreaterThan(0);
    expect(fp.isCompactLeaf(leaf.id)).toBe(true); // scene exercises the compact rule
    for (const node of nodes) {
      expect(emittedSize(node), `node ${node.type}:${node.id}`).toEqual(
        resolverSize(node, state, fp),
      );
    }
  });

  it('projects the compact flag straight from the resolver rule', () => {
    const { state, leaf } = makeScene();
    const fp = footprints(state);
    const { nodes } = graphToFlow(state, makeOptions());
    for (const node of nodes.filter((n) => n.type === 'device')) {
      expect(node.data['compact']).toBe(fp.isCompactLeaf(node.id));
    }
    expect(nodes.find((n) => n.id === leaf.id)?.data['compact']).toBe(true);
  });

  it('sizes collapsed Sites and Zones with the collapsed footprints', () => {
    const { state, sizedSite, defaultSite, sizedZone } = makeScene();
    const view = { collapsedSites: [defaultSite.id], collapsedZones: [sizedZone.id] };
    const fp = footprints(state, view);
    const { nodes } = graphToFlow(state, makeOptions(view));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // the resolver answers collapsed rects too, and they stay pinned to the
    // rendered collapsed cards
    expect(emittedSize(byId.get(defaultSite.id) as Node)).toEqual({ width: 200, height: 48 });
    expect(emittedSize(byId.get(sizedZone.id) as Node)).toEqual({ width: 170, height: 34 });
    const collapsedRect = fp.siteRect(defaultSite);
    expect(emittedSize(byId.get(defaultSite.id) as Node)).toEqual({
      width: collapsedRect.width,
      height: collapsedRect.height,
    });
    expect(emittedSize(byId.get(sizedZone.id) as Node)).toEqual(fp.zoneSize(sizedZone));
    // the expanded site is untouched by its sibling collapsing
    expect(emittedSize(byId.get(sizedSite.id) as Node)).toEqual({ width: 700, height: 500 });
  });
});
