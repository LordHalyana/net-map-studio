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
import { useAppStore, type Selection } from '../state/store';
import { buildDevice, deleteDevicesChangeSet, opCreateDevice, opSetField } from '../state/ops';
import { DeviceNode } from './DeviceNode';
import { NetworkNode, SiteNode, ZoneNode } from './ContainerNodes';
import { graphToFlow } from './graphToFlow';
import { DND_MIME } from '../layout/LibraryPanel';

const nodeTypes = { device: DeviceNode, site: SiteNode, zone: ZoneNode, network: NetworkNode };

const nodeTypeToSelection: Record<string, Selection['entityType']> = {
  device: 'device',
  site: 'site',
  zone: 'zone',
  network: 'network',
};

function CanvasInner() {
  const graph = useAppStore((s) => s.graph);
  const project = useAppStore((s) => s.project);
  const layers = useAppStore((s) => s.layers);
  const collapsedSites = useAppStore((s) => s.collapsedSites);
  const dispatch = useAppStore((s) => s.dispatch);
  const select = useAppStore((s) => s.select);
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes] = useState<Node[]>([]);

  const flow = useMemo(
    () =>
      graph
        ? graphToFlow(graph, { logical: layers.logical, collapsedSites })
        : { nodes: [], edges: [] },
    [graph, layers, collapsedSites],
  );

  // Adopt graph-derived nodes, preserving live drag/selection state React Flow holds.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      return flow.nodes.map((node) => {
        const existing = byId.get(node.id);
        if (existing?.dragging) return existing;
        return existing?.selected ? { ...node, selected: true } : node;
      });
    });
  }, [flow.nodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (!project || !graph) return;
      const { x, y } = node.position;
      switch (node.type) {
        case 'device': {
          const device = graph.devices.find((d) => d.id === node.id);
          if (device && (device.position.x !== x || device.position.y !== y)) {
            dispatch(
              opSetField(
                project.id,
                'device',
                device.id,
                'position',
                node.position,
                device.position,
              ),
            );
          }
          return;
        }
        case 'zone': {
          const zone = graph.zones.find((z) => z.id === node.id);
          if (zone && (zone.position.x !== x || zone.position.y !== y)) {
            dispatch(
              opSetField(project.id, 'zone', zone.id, 'position', node.position, zone.position),
            );
          }
          return;
        }
        case 'site': {
          const site = graph.sites.find((s) => s.id === node.id);
          if (site && (site.position.x !== x || site.position.y !== y)) {
            dispatch(
              opSetField(project.id, 'site', site.id, 'position', node.position, site.position),
            );
          }
          return;
        }
        case 'network': {
          // Per-(network, view) layout hint (ADR-0013) — the projection keeps
          // its position without the Network becoming a topological node.
          const network = graph.networks.find((n) => n.id === node.id);
          const previous = network?.layoutHints['main'];
          if (network && (previous?.x !== x || previous?.y !== y)) {
            dispatch(
              opSetField(
                project.id,
                'network',
                network.id,
                'layoutHints',
                { ...network.layoutHints, main: node.position },
                network.layoutHints,
              ),
            );
          }
          return;
        }
      }
    },
    [project, graph, dispatch],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (selectedNodes.length === 0) {
        select(null);
        return;
      }
      const first = selectedNodes[0];
      const entityType = first?.type ? nodeTypeToSelection[first.type] : undefined;
      if (!entityType) {
        select(null);
        return;
      }
      const sameType = selectedNodes.filter((n) => n.type === first?.type);
      select({ entityType, ids: sameType.map((n) => n.id) });
    },
    [select],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const state = useAppStore.getState().graph;
      if (!state) return;
      const deviceIds = deleted.filter((n) => n.type === 'device').map((n) => n.id);
      const cs = deleteDevicesChangeSet(state, deviceIds);
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
        edges={flow.edges}
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
