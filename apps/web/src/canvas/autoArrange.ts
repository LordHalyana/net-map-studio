import dagre from '@dagrejs/dagre';
import type { ChangeSet, Operation, ProjectState } from '@netplan/domain';
import { changeSet, opSetField } from '../state/ops';

const NODE_WIDTH = 170;
const NODE_HEIGHT = 64;
const NETWORK_WIDTH = 200;
const NETWORK_HEIGHT = 52;

/**
 * Auto-arrange (design §3.2C; hierarchical since visual-parity M2, gap G2):
 * top-to-bottom layers matching the concept — internet/firewall/core along
 * the Link topology, then network-nodes, then their member endpoints.
 * Networks join the layout as rank nodes but their positions are written as
 * per-view layout hints, never device positions (ADR-0013). Pinned devices
 * keep their positions — they participate as fixed context but no Operation
 * is emitted for them. Devices inside Zones are left alone. Returns one
 * ChangeSet so the whole arrangement undoes atomically.
 */
export function autoArrangeChangeSet(state: ProjectState): ChangeSet | null {
  const candidates = state.devices.filter((d) => !d.zoneId);
  const movable = candidates.filter((d) => !d.pinned);
  if (movable.length === 0) return null;

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const device of candidates) {
    graph.setNode(device.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const network of state.networks) {
    graph.setNode(network.id, { width: NETWORK_WIDTH, height: NETWORK_HEIGHT });
  }

  const deviceByInterface = new Map(state.interfaces.map((i) => [i.id, i.deviceId]));
  const infraDevices = new Set<string>();
  for (const link of state.links) {
    const source = deviceByInterface.get(link.source.id);
    const target = deviceByInterface.get(link.target.id);
    if (source) infraDevices.add(source);
    if (target) infraDevices.add(target);
    if (source && target && graph.hasNode(source) && graph.hasNode(target) && source !== target) {
      graph.setEdge(source, target);
    }
  }

  // Membership decides the lower layers: infrastructure hangs the network
  // beneath it; the network hangs its member endpoints beneath itself.
  for (const iface of state.interfaces) {
    if (!iface.networkId) continue;
    if (!graph.hasNode(iface.deviceId) || !graph.hasNode(iface.networkId)) continue;
    if (infraDevices.has(iface.deviceId)) {
      if (!graph.hasEdge(iface.deviceId, iface.networkId)) {
        graph.setEdge(iface.deviceId, iface.networkId);
      }
    } else if (!graph.hasEdge(iface.networkId, iface.deviceId)) {
      graph.setEdge(iface.networkId, iface.deviceId);
    }
  }

  dagre.layout(graph);

  const ops: Operation[] = movable.flatMap((device) => {
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

  for (const network of state.networks) {
    const node = graph.node(network.id);
    if (!node) continue;
    const position = {
      x: Math.round(node.x - NETWORK_WIDTH / 2),
      y: Math.round(node.y - NETWORK_HEIGHT / 2),
    };
    const previous = network.layoutHints['main'];
    if (previous && previous.x === position.x && previous.y === position.y) continue;
    ops.push(
      opSetField(
        state.project.id,
        'network',
        network.id,
        'layoutHints',
        { ...network.layoutHints, main: position },
        network.layoutHints,
      ),
    );
  }

  if (ops.length === 0) return null;
  return changeSet(state.project.id, 'Auto-arrange', ops);
}
