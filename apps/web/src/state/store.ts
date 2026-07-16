import { create } from 'zustand';
import {
  netplanBundleSchema,
  projectSchema,
  type ChangeSet,
  type FieldProvenance,
  type ImportJob,
  type ImportResolutionAction,
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
import {
  getFindings,
  setFindingStatus as apiSetFindingStatus,
  type FindingsReport,
} from '../api/findings';
import type { FindingStatus } from '@netplan/domain';
import {
  commitImport,
  createImport,
  getImportDetail,
  listImports,
  listProjectProvenance,
  resolveImportConflict,
  rollbackImport,
  type ImportJobDetail,
  type UploadImportInput,
} from '../api/imports';
import { applyOperationOptimistic } from './reducer';

export interface Selection {
  entityType: 'device' | 'network' | 'zone' | 'site' | 'link' | 'policyRule' | 'identity';
  ids: string[];
}

export interface LayerState {
  /** Show network-nodes, membership edges and per-network tints (ADR-0013). */
  logical: boolean;
  /** Show physical topology: Link/bundle edges. */
  physical: boolean;
  /** Show observed traffic: aggregated Flow bundles (Phase 2). */
  observed: boolean;
  /** Identity overlay (§3.9): chips on devices, off by default. */
  identities: boolean;
  /** Planned-rule callout cards on the canvas (visual-parity M4, gap G4). */
  rules: boolean;
}

export type ContextTab = 'details' | 'rules' | 'activity' | 'conflicts' | 'diff';

/** Which primary workspace fills the central region (design §3.2B). */
export type WorkspaceView = 'canvas' | 'imports' | 'identities' | 'findings' | 'egress';

/** AS-IS / TO-BE / Diff rendering mode (ADR-0009, design §3.10). */
export type CanvasMode = 'asIs' | 'toBe' | 'diff';

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
  collapsedZones: string[];
  connectMode: boolean;
  connectDraft: ConnectDraft;
  connectNotice: string | null;
  view: WorkspaceView;
  canvasMode: CanvasMode;
  /** Grid display + snap-to-grid (M2, #59) — one switch for both. */
  gridEnabled: boolean;
  /** Whole-project provenance sidecar mirror — feeds badges and the inspector. */
  provenance: FieldProvenance[];
  importJobs: ImportJob[];
  selectedImport: ImportJobDetail | null;
  importNotice: string | null;
  /** Findings report (ADR-0023), recomputed on demand — always current. */
  findings: FindingsReport | null;
  findingsLoading: boolean;
  findingsError: string | null;
  refreshFindings: () => Promise<void>;
  disposeFinding: (
    fingerprint: string,
    status: FindingStatus,
    previousStatus: FindingStatus,
  ) => Promise<void>;
  bootstrap: () => Promise<void>;
  reload: () => Promise<void>;
  dispatch: (payload: Operation | ChangeSet) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  select: (selection: Selection | null) => void;
  importBundle: (bundleText: string) => Promise<void>;
  contextTab: ContextTab;
  setContextTab: (tab: ContextTab) => void;
  toggleLogicalLayer: () => void;
  togglePhysicalLayer: () => void;
  toggleObservedLayer: () => void;
  toggleIdentityOverlay: () => void;
  toggleRulesLayer: () => void;
  setView: (view: WorkspaceView) => void;
  setCanvasMode: (mode: CanvasMode) => void;
  toggleGrid: () => void;
  refreshProvenance: () => Promise<void>;
  refreshImports: () => Promise<void>;
  uploadImport: (input: UploadImportInput) => Promise<void>;
  selectImport: (jobId: string | null) => Promise<void>;
  resolveConflict: (conflictId: string, action: ImportResolutionAction) => Promise<void>;
  commitSelectedImport: () => Promise<void>;
  rollbackSelectedImport: () => Promise<void>;
  toggleSiteCollapsed: (siteId: string) => void;
  toggleZoneCollapsed: (zoneId: string) => void;
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
  layers: { logical: true, physical: true, observed: true, identities: false, rules: true },
  collapsedSites: [],
  collapsedZones: [],
  contextTab: 'details',
  connectMode: false,
  connectDraft: emptyDraft,
  connectNotice: null,
  view: 'canvas',
  canvasMode: 'toBe',
  gridEnabled: true,
  provenance: [],
  importJobs: [],
  selectedImport: null,
  importNotice: null,
  findings: null,
  findingsLoading: false,
  findingsError: null,

  refreshFindings: async () => {
    const project = get().project;
    if (!project) return;
    set({ findingsLoading: true, findingsError: null });
    try {
      set({ findings: await getFindings(project.id), findingsLoading: false });
    } catch (error) {
      set({
        findingsLoading: false,
        findingsError: error instanceof Error ? error.message : 'Failed to load findings',
      });
    }
  },

  /** Change a finding's disposition through the Operation log, then re-analyze. */
  disposeFinding: async (fingerprint, status, previousStatus) => {
    const project = get().project;
    if (!project) return;
    const response = await apiSetFindingStatus(project.id, fingerprint, status, previousStatus);
    set({ availability: response.availability });
    await get().refreshFindings();
  },

  bootstrap: () => {
    bootstrapPromise ??= (async () => {
      const projects = await listProjects();
      const project = projects[0] ?? (await createProject('Untitled Project'));
      const [graph, availability, provenance] = await Promise.all([
        getGraph(project.id),
        getAvailability(project.id),
        listProjectProvenance(project.id),
      ]);
      set({ project, graph, availability, provenance });
    })().catch((error: unknown) => {
      bootstrapPromise = null; // allow a retry after a failed boot
      throw error;
    });
    return bootstrapPromise;
  },

  reload: async () => {
    const project = get().project;
    if (!project) return;
    const [graph, provenance] = await Promise.all([
      getGraph(project.id),
      listProjectProvenance(project.id),
    ]);
    set({ graph, provenance });
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

  setContextTab: (tab) => set({ contextTab: tab }),

  toggleLogicalLayer: () => set({ layers: { ...get().layers, logical: !get().layers.logical } }),

  togglePhysicalLayer: () => set({ layers: { ...get().layers, physical: !get().layers.physical } }),

  toggleObservedLayer: () => set({ layers: { ...get().layers, observed: !get().layers.observed } }),

  toggleIdentityOverlay: () =>
    set({ layers: { ...get().layers, identities: !get().layers.identities } }),

  toggleRulesLayer: () => set({ layers: { ...get().layers, rules: !get().layers.rules } }),

  setView: (view) => set({ view }),

  setCanvasMode: (mode) => set({ canvasMode: mode }),

  toggleGrid: () => set({ gridEnabled: !get().gridEnabled }),

  refreshProvenance: async () => {
    const project = get().project;
    if (!project) return;
    set({ provenance: await listProjectProvenance(project.id) });
  },

  // ---------- imports & reconciliation (ADR-0019/0021, plan M7) ----------

  refreshImports: async () => {
    const project = get().project;
    if (!project) return;
    set({ importJobs: await listImports(project.id) });
  },

  uploadImport: async (input) => {
    const project = get().project;
    if (!project) return;
    set({ importNotice: null });
    try {
      const job = await createImport(project.id, input);
      set({ importJobs: [...get().importJobs, job] });
      // poll the background worker until it leaves pending/parsing
      for (let attempt = 0; attempt < 100; attempt++) {
        const detail = await getImportDetail(project.id, job.id);
        if (detail.job.status !== 'pending' && detail.job.status !== 'parsing') {
          set({
            selectedImport: detail,
            importJobs: get().importJobs.map((j) => (j.id === job.id ? detail.job : j)),
            ...(detail.job.status === 'review' &&
            detail.proposal &&
            detail.proposal.conflicts.length > 0
              ? { contextTab: 'conflicts' as const }
              : {}),
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      set({ importNotice: 'Import is still parsing — check the job list.' });
    } catch (error) {
      set({ importNotice: error instanceof Error ? error.message : 'Import failed' });
    }
  },

  selectImport: async (jobId) => {
    const project = get().project;
    if (!project || jobId === null) {
      set({ selectedImport: null });
      return;
    }
    set({ selectedImport: await getImportDetail(project.id, jobId) });
  },

  /** Resolving a conflict rewrites the pending ChangeSet (ADR-0021). */
  resolveConflict: async (conflictId, action) => {
    const project = get().project;
    const selected = get().selectedImport;
    if (!project || !selected) return;
    set({ importNotice: null });
    try {
      const proposal = await resolveImportConflict(project.id, selected.job.id, conflictId, action);
      set({ selectedImport: { ...selected, proposal } });
    } catch (error) {
      set({ importNotice: error instanceof Error ? error.message : 'Resolve failed' });
    }
  },

  commitSelectedImport: async () => {
    const project = get().project;
    const selected = get().selectedImport;
    if (!project || !selected) return;
    set({ importNotice: null });
    try {
      const result = await commitImport(project.id, selected.job.id);
      set({
        graph: result.state,
        selectedImport: {
          job: result.job,
          evidence: result.evidence,
          observations: result.observations,
          proposal: result.proposal,
        },
        importJobs: get().importJobs.map((j) => (j.id === result.job.id ? result.job : j)),
        availability: await getAvailability(project.id),
        provenance: await listProjectProvenance(project.id),
      });
    } catch (error) {
      set({ importNotice: error instanceof Error ? error.message : 'Commit failed' });
    }
  },

  rollbackSelectedImport: async () => {
    const project = get().project;
    const selected = get().selectedImport;
    if (!project || !selected) return;
    set({ importNotice: null });
    try {
      const result = await rollbackImport(project.id, selected.job.id);
      set({
        graph: result.state,
        selectedImport: {
          job: result.job,
          evidence: result.evidence,
          observations: result.observations,
          proposal: result.proposal,
        },
        importJobs: get().importJobs.map((j) => (j.id === result.job.id ? result.job : j)),
        availability: await getAvailability(project.id),
        provenance: await listProjectProvenance(project.id),
      });
    } catch (error) {
      set({ importNotice: error instanceof Error ? error.message : 'Rollback failed' });
    }
  },

  toggleSiteCollapsed: (siteId) => {
    const current = get().collapsedSites;
    set({
      collapsedSites: current.includes(siteId)
        ? current.filter((id) => id !== siteId)
        : [...current, siteId],
    });
  },

  toggleZoneCollapsed: (zoneId) => {
    const current = get().collapsedZones;
    set({
      collapsedZones: current.includes(zoneId)
        ? current.filter((id) => id !== zoneId)
        : [...current, zoneId],
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
