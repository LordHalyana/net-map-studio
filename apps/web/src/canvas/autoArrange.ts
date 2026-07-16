import dagre from '@dagrejs/dagre';
import type { ChangeSet, Operation, ProjectState } from '@netplan/domain';
import { changeSet, opSetField } from '../state/ops';
import { footprints } from './footprints';

const NODE_SEP = 56;
const RANK_SEP = 96;
/** Clearance between the arranged block and the obstacle it shifts below (#75). */
const OBSTACLE_GAP = 40;

type Rect = { x: number; y: number; width: number; height: number };

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Reserve-the-region (#75): dagre lays out only free devices, so Site rects
 * and pinned devices' real footprints are invisible to it. If any arranged
 * box lands on such an obstacle, translate the whole block straight down
 * (matching TB rank direction) to OBSTACLE_GAP below the lowest obstacle
 * whose x-span overlaps the block's — vertical translation never changes the
 * block's x-span, so one shift is collision-free. Zones and zone-contained
 * devices need no boxes of their own: extent 'parent' keeps them inside
 * their Site rect. Site collapse is view state and deliberately ignored so
 * the guarantee survives expansion.
 */
function obstacleShift(arranged: Rect[], obstacles: Rect[]): number {
  if (!arranged.some((box) => obstacles.some((o) => intersects(box, o)))) return 0;
  const left = Math.min(...arranged.map((box) => box.x));
  const right = Math.max(...arranged.map((box) => box.x + box.width));
  const top = Math.min(...arranged.map((box) => box.y));
  const bottom = Math.max(
    ...obstacles.filter((o) => o.x < right && left < o.x + o.width).map((o) => o.y + o.height),
  );
  return Math.round(bottom + OBSTACLE_GAP - top);
}

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
  graph.setGraph({ rankdir: 'TB', nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));

  // dagre lays out the exact footprints the canvas paints (#78)
  const fp = footprints(state);
  for (const device of candidates) {
    graph.setNode(device.id, { ...fp.device(device.id) });
  }
  for (const network of state.networks) {
    graph.setNode(network.id, { ...fp.network() });
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

  const boxOf = (id: string, size: { width: number; height: number }): Rect | null => {
    const node = graph.node(id);
    if (!node) return null;
    return {
      x: Math.round(node.x - size.width / 2),
      y: Math.round(node.y - size.height / 2),
      ...size,
    };
  };

  const arrangedDevices = movable.flatMap((device) => {
    const box = boxOf(device.id, fp.device(device.id));
    return box ? [{ device, box }] : [];
  });
  const arrangedNetworks = state.networks.flatMap((network) => {
    const box = boxOf(network.id, fp.network());
    return box ? [{ network, box }] : [];
  });

  const obstacles: Rect[] = [
    ...state.sites.map((site) => fp.siteRect(site)),
    ...candidates.filter((d) => d.pinned).map((d) => ({ ...d.position, ...fp.device(d.id) })),
  ];
  const shift = obstacleShift(
    [...arrangedDevices, ...arrangedNetworks].map((a) => a.box),
    obstacles,
  );

  const ops: Operation[] = arrangedDevices.flatMap(({ device, box }) => {
    const position = { x: box.x, y: box.y + shift };
    if (position.x === device.position.x && position.y === device.position.y) return [];
    return [
      opSetField(state.project.id, 'device', device.id, 'position', position, device.position),
    ];
  });

  for (const { network, box } of arrangedNetworks) {
    const position = { x: box.x, y: box.y + shift };
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
