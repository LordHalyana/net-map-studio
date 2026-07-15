import { create } from 'zustand';
import type {
  ChangeSet,
  Operation,
  Project,
  ProjectState,
  UndoRedoAvailability,
} from '@netplan/domain';
import {
  createProject,
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

interface AppState {
  project: Project | null;
  graph: ProjectState | null;
  availability: UndoRedoAvailability;
  selection: Selection | null;
  syncError: string | null;
  pendingOps: number;
  bootstrap: () => Promise<void>;
  reload: () => Promise<void>;
  dispatch: (payload: Operation | ChangeSet) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  select: (selection: Selection | null) => void;
}

/** Serializes syncs so operations reach the server in dispatch order. */
let syncQueue: Promise<void> = Promise.resolve();

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  graph: null,
  availability: { canUndo: false, canRedo: false },
  selection: null,
  syncError: null,
  pendingOps: 0,

  bootstrap: async () => {
    const projects = await listProjects();
    const project = projects[0] ?? (await createProject('Untitled Project'));
    const graph = await getGraph(project.id);
    set({ project, graph });
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
}));
