import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAppStore } from '../state/store';
import { opSetField } from '../state/ops';
import { DeviceNode, type DeviceFlowNode } from './DeviceNode';

const nodeTypes = { device: DeviceNode };

function deviceNodesFromGraph(devices: DeviceFlowNode['data']['device'][]): Node[] {
  return devices.map((device) => ({
    id: device.id,
    type: 'device',
    position: device.position,
    data: { device },
  }));
}

export function Canvas() {
  const graph = useAppStore((s) => s.graph);
  const project = useAppStore((s) => s.project);
  const dispatch = useAppStore((s) => s.dispatch);
  const select = useAppStore((s) => s.select);

  const [nodes, setNodes] = useState<Node[]>([]);

  const graphNodes = useMemo(() => deviceNodesFromGraph(graph?.devices ?? []), [graph]);

  // Adopt graph-derived nodes, preserving live drag positions React Flow holds.
  useEffect(() => {
    setNodes((current) => {
      const dragging = new Map(current.filter((n) => n.dragging).map((n) => [n.id, n]));
      return graphNodes.map((node) => dragging.get(node.id) ?? node);
    });
  }, [graphNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (!project || !graph) return;
      const device = graph.devices.find((d) => d.id === node.id);
      if (!device) return;
      if (device.position.x === node.position.x && device.position.y === node.position.y) return;
      dispatch(
        opSetField(project.id, 'device', device.id, 'position', node.position, device.position),
      );
    },
    [project, graph, dispatch],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      const first = selectedNodes[0];
      select(first ? { entityType: 'device', id: first.id } : null);
    },
    [select],
  );

  return (
    <main className="canvas-region" data-testid="canvas-region">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        colorMode="dark"
        snapToGrid
        snapGrid={[16, 16]}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </main>
  );
}
