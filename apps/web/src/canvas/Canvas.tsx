import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
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
  const collapsedZones = useAppStore((s) => s.collapsedZones);
  const dispatch = useAppStore((s) => s.dispatch);
  const select = useAppStore((s) => s.select);
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const canvasMode = useAppStore((s) => s.canvasMode);
  const provenance = useAppStore((s) => s.provenance);

  const flow = useMemo(
    () =>
      graph
        ? graphToFlow(graph, {
            logical: layers.logical,
            physical: layers.physical,
            observed: layers.observed,
            identities: layers.identities,
            mode: canvasMode,
            provenance,
            collapsedSites,
            collapsedZones,
          })
        : { nodes: [], edges: [] },
    [graph, layers, canvasMode, provenance, collapsedSites, collapsedZones],
  );

  // Adopt graph-derived nodes, preserving drag/selection state AND object
  // identity for unchanged nodes — replacing every object makes React Flow
  // drop its measurements and flash the whole canvas invisible.
  useEffect(() => {
    const nodeContent = (n: Node) =>
      JSON.stringify([
        n.type,
        n.position,
        n.parentId,
        n.extent,
        n.hidden,
        n.style,
        n.zIndex,
        n.data,
      ]);
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      return flow.nodes.map((node) => {
        const existing = byId.get(node.id);
        if (!existing) return node;
        if (existing.dragging) return existing;
        if (nodeContent(existing) === nodeContent(node)) return existing;
        return existing.selected ? { ...node, selected: true } : node;
      });
    });
  }, [flow.nodes]);

  useEffect(() => {
    const edgeContent = (e: Edge) =>
      JSON.stringify([
        e.source,
        e.target,
        e.sourceHandle,
        e.targetHandle,
        e.style,
        e.label,
        e.data,
        e.hidden,
      ]);
    setEdges((current) => {
      const byId = new Map(current.map((e) => [e.id, e]));
      return flow.edges.map((edge) => {
        const existing = byId.get(edge.id);
        if (!existing) return edge;
        if (edgeContent(existing) === edgeContent(edge)) return existing;
        return existing.selected ? { ...edge, selected: true } : edge;
      });
    });
  }, [flow.edges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
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
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      if (selectedNodes.length === 0 && selectedEdges.length > 0) {
        // link edges carry the underlying Link ids (bundles carry several)
        const linkIds = selectedEdges.flatMap((edge) => {
          const data = edge.data;
          return data && Array.isArray(data['linkIds'])
            ? data['linkIds'].filter((v): v is string => typeof v === 'string')
            : [];
        });
        select(linkIds.length > 0 ? { entityType: 'link', ids: linkIds } : null);
        return;
      }
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

  const connectMode = useAppStore((s) => s.connectMode);
  const connectPickNode = useAppStore((s) => s.connectPickNode);

  const onNodeClick = useCallback(
    (_event: unknown, node: Node) => {
      if (connectMode && node.type) connectPickNode(node.type, node.id);
    },
    [connectMode, connectPickNode],
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

  // command-bar requests: focus an entity, apply a zoom preset
  const { setCenter, zoomTo } = useReactFlow();
  useEffect(() => {
    function onFocusNode(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const id = detail && typeof detail === 'object' ? detail.id : null;
      if (typeof id !== 'string') return;
      const state = useAppStore.getState().graph;
      if (!state) return;
      const device = state.devices.find((d) => d.id === id);
      const network = state.networks.find((n) => n.id === id);
      const position = device?.position ?? network?.layoutHints['main'];
      if (position) void setCenter(position.x + 80, position.y + 30, { zoom: 1.2, duration: 350 });
    }
    function onZoomPreset(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const level = detail && typeof detail === 'object' ? detail.level : null;
      if (typeof level === 'number') void zoomTo(level, { duration: 250 });
    }
    window.addEventListener('netplan:focus-node', onFocusNode);
    window.addEventListener('netplan:zoom', onZoomPreset);
    return () => {
      window.removeEventListener('netplan:focus-node', onFocusNode);
      window.removeEventListener('netplan:zoom', onZoomPreset);
    };
  }, [setCenter, zoomTo]);

  // PNG/SVG topology export (design §3.12) — listens for command-bar requests.
  useEffect(() => {
    async function onExportImage(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const format = detail && typeof detail === 'object' ? detail.format : null;
      const element = document.querySelector('.react-flow');
      if (!(element instanceof HTMLElement)) return;
      const { toPng, toSvg } = await import('html-to-image');
      const options = { backgroundColor: '#0f1115', filter: excludeChrome };
      const dataUrl =
        format === 'svg' ? await toSvg(element, options) : await toPng(element, options);
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = `topology.${format === 'svg' ? 'svg' : 'png'}`;
      anchor.click();
    }
    function excludeChrome(node: HTMLElement): boolean {
      return !(
        node.classList?.contains('react-flow__minimap') ||
        node.classList?.contains('react-flow__controls')
      );
    }
    window.addEventListener('netplan:export-image', onExportImage);
    return () => window.removeEventListener('netplan:export-image', onExportImage);
  }, []);

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
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
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
        // viewport culling once the canvas is big enough to care (design acceptance #1)
        onlyRenderVisibleElements={nodes.length > 60}
        minZoom={0.05}
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
