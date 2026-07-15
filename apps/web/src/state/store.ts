import { create } from 'zustand';
import {
  netplanBundleSchema,
  projectSchema,
  type ChangeSet,
  type Operation,
  type Project,
  type ProjectState,
  type UndoRedoAvailability,
} from '@netplan/domain';
import {
  createProject,
  getAvailability,
  getGraph,
  listProjects,
  postOperation,
  postRedo,
  postUndo,
} from '../api/client';
import { applyOperationOptimistic } from './reducer';

export interface Selection {
  entityType: 'device' | 'network' | 'zone' | 'site' | 'link' | 'policyRule';
  ids: string[];
}

export interface LayerState {
  /** Show network-nodes, membership edges and per-network tints (ADR-0013). */
  logical: boolean;
}

/**
 * Connect mode (design §3.3): pick a source Interface, pick a destination,
 * complete a compact form. Links terminate on Interfaces only (ADR-0012).
 */
export interface ConnectDraft {
  sourceDeviceId: string | null;
  sourceInterfaceId: string | null;
  targetDeviceId: string | null;
  targetInterfaceId: string | null;
}

const emptyDraft: ConnectDraft = {
  sourceDeviceId: null,
  sourceInterfaceId: null,
  targetDeviceId: null,
  targetInterfaceId: null,
};

interface AppState {
  project: Project | null;
  graph: ProjectState | null;
  availability: UndoRedoAvailability;
  selection: Selection | null;
  syncError: string | null;
  pendingOps: number;
  layers: LayerState;
  collapsedSites: string[];
  connectMode: boolean;
  connectDraft: ConnectDraft;
  connectNotice: string | null;
  bootstrap: () => Promise<void>;
  reload: () => Promise<void>;
  dispatch: (payload: Operation | ChangeSet) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  select: (selection: Selection | null) => void;
  importBundle: (bundleText: string) => Promise<void>;
  toggleLogicalLayer: () => void;
  toggleSiteCollapsed: (siteId: string) => void;
  toggleConnectMode: () => void;
  connectPickNode: (nodeType: string, nodeId: string) => void;
  setConnectInterface: (side: 'source' | 'target', interfaceId: string | null) => void;
  resetConnectDraft: () => void;
}

/** Serializes syncs so operations reach the server in dispatch order. */
let syncQueue: Promise<void> = Promise.resolve();

/** Single-flight guard: StrictMode re-runs effects, and a double bootstrap would create two projects. */
let bootstrapPromise: Promise<void> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  graph: null,
  availability: { canUndo: false, canRedo: false },
  selection: null,
  syncError: null,
  pendingOps: 0,
  layers: { logical: true },
  collapsedSites: [],
  connectMode: false,
  connectDraft: emptyDraft,
  connectNotice: null,

  bootstrap: () => {
    bootstrapPromise ??= (async () => {
      const projects = await listProjects();
      const project = projects[0] ?? (await createProject('Untitled Project'));
      const [graph, availability] = await Promise.all([
        getGraph(project.id),
        getAvailability(project.id),
      ]);
      set({ project, graph, availability });
    })().catch((error: unknown) => {
      bootstrapPromise = null; // allow a retry after a failed boot
      throw error;
    });
    return bootstrapPromise;
  },

  reload: async () => {
    const project = get().project;
    if (!project) return;
    set({ graph: await getGraph(project.id) });
  },

  dispatch: (payload) => {
    const { project, graph } = get();
    if (!project || !graph) return;

    // optimistic local apply (a ChangeSet is applied op-by-op)
    const ops: Operation[] = 'operations' in payload ? payload.operations : [payload];
    let next = graph;
    for (const op of ops) next = applyOperationOptimistic(next, op);
    set({ graph: next, pendingOps: get().pendingOps + 1, syncError: null });

    syncQueue = syncQueue
      .then(async () => {
        const response = await postOperation(project.id, payload);
        const pending = get().pendingOps - 1;
        // Only adopt the server graph when nothing newer is in flight,
        // so optimistic edits are not visually reverted mid-burst.
        set({
          pendingOps: pending,
          availability: response.availability,
          ...(pending === 0 ? { graph: response.state } : {}),
        });
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Sync failed';
        try {
          const graphNow = await getGraph(project.id);
          set({ graph: graphNow, pendingOps: 0, syncError: message });
        } catch {
          set({ pendingOps: 0, syncError: message });
        }
      });
  },

  undo: async () => {
    const project = get().project;
    if (!project || !get().availability.canUndo) return;
    const response = await postUndo(project.id);
    set({ graph: response.state, availability: response.availability });
  },

  redo: async () => {
    const project = get().project;
    if (!project || !get().availability.canRedo) return;
    const response = await postRedo(project.id);
    set({ graph: response.state, availability: response.availability });
  },

  select: (selection) => set({ selection }),

  /** Restore a .netplan bundle (ADR-0016) and switch to the imported project. */
  importBundle: async (bundleText) => {
    const bundle = netplanBundleSchema.parse(JSON.parse(bundleText));
    const response = await fetch('/api/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `Import failed: ${response.status}`;
      throw new Error(message);
    }
    const project = projectSchema.parse(await response.json());
    const [graph, availability] = await Promise.all([
      getGraph(project.id),
      getAvailability(project.id),
    ]);
    set({ project, graph, availability, selection: null });
  },

  toggleLogicalLayer: () => set({ layers: { logical: !get().layers.logical } }),

  toggleSiteCollapsed: (siteId) => {
    const current = get().collapsedSites;
    set({
      collapsedSites: current.includes(siteId)
        ? current.filter((id) => id !== siteId)
        : [...current, siteId],
    });
  },

  toggleConnectMode: () =>
    set({ connectMode: !get().connectMode, connectDraft: emptyDraft, connectNotice: null }),

  connectPickNode: (nodeType, nodeId) => {
    if (!get().connectMode) return;
    if (nodeType !== 'device') {
      set({
        connectNotice: `A Link cannot terminate on a ${nodeType} — endpoints must be Interfaces.`,
      });
      return;
    }
    const graph = get().graph;
    const draft = get().connectDraft;
    const firstInterface = graph?.interfaces.find((i) => i.deviceId === nodeId)?.id ?? null;
    if (!draft.sourceDeviceId) {
      set({
        connectDraft: { ...draft, sourceDeviceId: nodeId, sourceInterfaceId: firstInterface },
        connectNotice: null,
      });
    } else if (nodeId !== draft.sourceDeviceId) {
      set({
        connectDraft: { ...draft, targetDeviceId: nodeId, targetInterfaceId: firstInterface },
        connectNotice: null,
      });
    }
  },

  setConnectInterface: (side, interfaceId) => {
    const draft = get().connectDraft;
    set({
      connectDraft:
        side === 'source'
          ? { ...draft, sourceInterfaceId: interfaceId }
          : { ...draft, targetInterfaceId: interfaceId },
    });
  },

  resetConnectDraft: () => set({ connectDraft: emptyDraft, connectNotice: null }),
}));
