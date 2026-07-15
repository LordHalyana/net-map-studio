import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { deviceTypeSchema } from '@netplan/domain';
import { useAppStore } from '../state/store';
import { buildDevice, deleteDevicesChangeSet, opCreateDevice, opSetField } from '../state/ops';
import { DeviceNode, type DeviceFlowNode } from './DeviceNode';
import { DND_MIME } from '../layout/LibraryPanel';

const nodeTypes = { device: DeviceNode };

function deviceNodesFromGraph(devices: DeviceFlowNode['data']['device'][]): Node[] {
  return devices.map((device) => ({
    id: device.id,
    type: 'device',
    position: device.position,
    data: { device },
  }));
}

function CanvasInner() {
  const graph = useAppStore((s) => s.graph);
  const project = useAppStore((s) => s.project);
  const dispatch = useAppStore((s) => s.dispatch);
  const select = useAppStore((s) => s.select);
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes] = useState<Node[]>([]);

  const graphNodes = useMemo(() => deviceNodesFromGraph(graph?.devices ?? []), [graph]);

  // Adopt graph-derived nodes, preserving live drag/selection state React Flow holds.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      return graphNodes.map((node) => {
        const existing = byId.get(node.id);
        if (existing?.dragging) return existing;
        return existing?.selected ? { ...node, selected: true } : node;
      });
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
      select(
        selectedNodes.length > 0
          ? { entityType: 'device', ids: selectedNodes.map((n) => n.id) }
          : null,
      );
    },
    [select],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const state = useAppStore.getState().graph;
      if (!state) return;
      const cs = deleteDevicesChangeSet(
        state,
        deleted.map((n) => n.id),
      );
      if (cs) dispatch(cs);
    },
    [dispatch],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    if (event.dataTransfer.types.includes(DND_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!project || !graph) return;
      const raw = event.dataTransfer.getData(DND_MIME);
      const parsed = deviceTypeSchema.safeParse(raw);
      if (!parsed.success) return;
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const device = buildDevice(
        project.id,
        parsed.data,
        position,
        new Set(graph.devices.map((d) => d.name)),
      );
      dispatch(opCreateDevice(project.id, device));
    },
    [project, graph, dispatch, screenToFlowPosition],
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
        onNodesDelete={onNodesDelete}
        onDragOver={onDragOver}
        onDrop={onDrop}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Control']}
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

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
