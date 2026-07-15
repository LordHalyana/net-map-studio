import dagre from '@dagrejs/dagre';
import type { ChangeSet, ProjectState } from '@netplan/domain';
import { changeSet, opSetField } from '../state/ops';

const NODE_WIDTH = 170;
const NODE_HEIGHT = 64;

/**
 * Auto-arrange (design §3.2C): lay out top-level Devices with dagre along the
 * Link topology. Pinned devices keep their positions — they participate in
 * the layout as fixed context but no Operation is emitted for them. Devices
 * inside Zones and network-node layout hints are left alone. Returns one
 * ChangeSet so the whole arrangement undoes atomically.
 */
export function autoArrangeChangeSet(state: ProjectState): ChangeSet | null {
  const candidates = state.devices.filter((d) => !d.zoneId);
  const movable = candidates.filter((d) => !d.pinned);
  if (movable.length === 0) return null;

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const device of candidates) {
    graph.setNode(device.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  const deviceByInterface = new Map(state.interfaces.map((i) => [i.id, i.deviceId]));
  for (const link of state.links) {
    const source = deviceByInterface.get(link.source.id);
    const target = deviceByInterface.get(link.target.id);
    if (source && target && graph.hasNode(source) && graph.hasNode(target) && source !== target) {
      graph.setEdge(source, target);
    }
  }
  // membership creates soft adjacency: devices sharing a network land near each other
  const byNetwork = new Map<string, string[]>();
  for (const iface of state.interfaces) {
    if (!iface.networkId || !graph.hasNode(iface.deviceId)) continue;
    const list = byNetwork.get(iface.networkId) ?? [];
    list.push(iface.deviceId);
    byNetwork.set(iface.networkId, list);
  }
  for (const members of byNetwork.values()) {
    for (let i = 1; i < members.length; i++) {
      const a = members[0];
      const b = members[i];
      if (a && b && a !== b && !graph.hasEdge(a, b)) graph.setEdge(a, b);
    }
  }

  dagre.layout(graph);

  const ops = movable.flatMap((device) => {
    const node = graph.node(device.id);
    if (!node) return [];
    const position = {
      x: Math.round(node.x - NODE_WIDTH / 2),
      y: Math.round(node.y - NODE_HEIGHT / 2),
    };
    if (position.x === device.position.x && position.y === device.position.y) return [];
    return [
      opSetField(state.project.id, 'device', device.id, 'position', position, device.position),
    ];
  });

  if (ops.length === 0) return null;
  return changeSet(state.project.id, 'Auto-arrange', ops);
}
