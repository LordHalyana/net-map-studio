import { create } from 'zustand';
import { z } from 'zod';
import {
  netplanBundleSchema,
  projectSchema,
  type ChangeSet,
  type FieldProvenance,
  type ImportJob,
  type ImportResolutionAction,
  type Operation,
  type OperationLogEntry,
  type Project,
  type ProjectState,
  type UndoRedoAvailability,
} from '@netplan/domain';
import {
  apiFetch,
  createProject,
  getAvailability,
  getGraph,
  getLog,
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

/** UI preference (ui-polish M7): the canvas shortcut card, on unless
 *  explicitly dismissed/disabled — the first localStorage-persisted pref. */
const HOTKEY_CARD_PREF_KEY = 'netplan.hotkeyCard';

function readHotkeyCardPref(): boolean {
  try {
    return localStorage.getItem(HOTKEY_CARD_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export interface Selection {
  entityType: 'device' | 'network' | 'zone' | 'site' | 'link' | 'policyRule' | 'identity' | 'flow';
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
  /** Findings layer (M5, #62): severity tint on affected devices. */
  findings: boolean;
}

export type ContextTab = 'details' | 'rules' | 'activity' | 'conflicts' | 'diff';

/** Which primary workspace fills the central region (design §3.2B). */
export type WorkspaceView =
  | 'overview'
  | 'canvas'
  | 'networks'
  | 'rules'
  | 'imports'
  | 'identities'
  | 'findings'
  | 'reports'
  | 'egress'
  | 'settings';

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

/** One queued notification (M6, #63): auto-dismissed, severity-tinted. */
export interface Toast {
  id: number;
  message: string;
  severity: 'info' | 'success' | 'error';
}

let toastSeq = 0;

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
  /** Epoch ms of the last acknowledged save (M6, #63 relative timestamp). */
  lastSavedAt: number | null;
  /** The server's operation-log seq after the last acknowledged mutation (#110 C4). */
  watermark: number | null;
  /** The one shared operation-log read (#110 D2) — panels consume via useOperationLog(). */
  operationLog: OperationLogEntry[];
  operationLogLoading: boolean;
  operationLogError: string | null;
  refreshOperationLog: () => Promise<void>;
  /**
   * Mark the cached log stale and refetch. For mutations that bypass the
   * store's dispatch path (proposal sign-off, finding dispositions) — they
   * append log rows without producing a new graph version.
   */
  invalidateOperationLog: () => void;
  /** Notification queue (M6, #63) - rendered by <Toasts/>, auto-dismissed. */
  toasts: Toast[];
  pushToast: (message: string, severity?: Toast['severity']) => void;
  dismissToast: (id: number) => void;
  layers: LayerState;
  collapsedSites: string[];
  collapsedZones: string[];
  connectMode: boolean;
  connectDraft: ConnectDraft;
  view: WorkspaceView;
  canvasMode: CanvasMode;
  /** Grid display + snap-to-grid (M2, #59) — one switch for both. */
  gridEnabled: boolean;
  /** Canvas shortcut cheat card (ui-polish M7) — persisted, on by default. */
  hotkeyCardEnabled: boolean;
  /** Rule row to highlight/scroll to in the Rules tab (M3, #60). */
  focusedRuleId: string | null;
  /** Finding card to highlight/scroll to in the Findings view (M3, #60). */
  focusedFindingFingerprint: string | null;
  /** Findings view scoped to one device — set by the canvas badge (M5, #62). */
  findingsDeviceFilter: string | null;
  /** Whole-project provenance sidecar mirror — feeds badges and the inspector. */
  provenance: FieldProvenance[];
  importJobs: ImportJob[];
  selectedImport: ImportJobDetail | null;
  /** Findings report (ADR-0023), recomputed on demand — always current. */
  findings: FindingsReport | null;
  findingsLoading: boolean;
  refreshFindings: () => Promise<void>;
  disposeFinding: (
    fingerprint: string,
    status: FindingStatus,
    previousStatus: FindingStatus,
  ) => Promise<void>;
  bootstrap: () => Promise<void>;
  reload: () => Promise<void>;
  /** Reveal a masked secret's original value — audited server-side (M13, #70). */
  revealSecret: (secretId: string) => Promise<string>;
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
  toggleFindingsLayer: () => void;
  /** Open the Findings view filtered to one device (M5, #62). */
  focusFindingsForDevice: (deviceId: string | null) => void;
  setView: (view: WorkspaceView) => void;
  setCanvasMode: (mode: CanvasMode) => void;
  toggleGrid: () => void;
  setHotkeyCardEnabled: (enabled: boolean) => void;
  /** Open the Rules tab with one rule focused (M3, #60). */
  focusRule: (ruleId: string) => void;
  /** Open the Findings view with one finding focused (M3, #60). */
  focusFinding: (fingerprint: string) => void;
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

// Import-poll generation counter (#110 D6): bumped by every uploadImport so
// a superseded poll loop stops writing state.
let importPollGeneration = 0;

// One log fetch per graph version (#110 D2): the synced marker is the graph
// object identity (every adoption produces a new object), the in-flight
// promise dedupes simultaneous panel mounts.
let logSynced: { projectId: string; graph: ProjectState | null } | null = null;
let logInflight: Promise<void> | null = null;

/** Single-flight guard: StrictMode re-runs effects, and a double bootstrap would create two projects. */
let bootstrapPromise: Promise<void> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  graph: null,
  availability: { canUndo: false, canRedo: false },
  selection: null,
  syncError: null,
  pendingOps: 0,
  lastSavedAt: null,
  watermark: null,
  operationLog: [],
  operationLogLoading: false,
  operationLogError: null,

  refreshOperationLog: async () => {
    const { project, graph } = get();
    if (!project) return;
    if (logSynced && logSynced.projectId === project.id && logSynced.graph === graph) return;
    if (logInflight) {
      // a fetch for an older graph version is running — let it land, then
      // re-check whether this version still needs one
      await logInflight;
      return get().refreshOperationLog();
    }
    const target = { projectId: project.id, graph };
    set({ operationLogLoading: true });
    logInflight = getLog(project.id)
      .then((entries) => {
        logSynced = target;
        set({ operationLog: entries, operationLogError: null, operationLogLoading: false });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to load the activity log';
        set({ operationLogError: message, operationLogLoading: false });
        get().pushToast(message);
      })
      .finally(() => {
        logInflight = null;
      });
    return logInflight;
  },

  invalidateOperationLog: () => {
    logSynced = null;
    void get().refreshOperationLog();
  },
  toasts: [],
  layers: {
    logical: true,
    physical: true,
    observed: true,
    identities: false,
    rules: true,
    findings: true,
  },
  collapsedSites: [],
  collapsedZones: [],
  contextTab: 'details',
  connectMode: false,
  connectDraft: emptyDraft,
  view: 'canvas',
  canvasMode: 'toBe',
  gridEnabled: true,
  hotkeyCardEnabled: readHotkeyCardPref(),
  focusedRuleId: null,
  focusedFindingFingerprint: null,
  findingsDeviceFilter: null,
  provenance: [],
  importJobs: [],
  selectedImport: null,
  findings: null,
  findingsLoading: false,

  pushToast: (message, severity = 'error') =>
    set({ toasts: [...get().toasts, { id: ++toastSeq, message, severity }] }),

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  refreshFindings: async () => {
    const project = get().project;
    if (!project) return;
    set({ findingsLoading: true });
    try {
      set({ findings: await getFindings(project.id), findingsLoading: false });
    } catch (error) {
      set({ findingsLoading: false });
      get().pushToast(error instanceof Error ? error.message : 'Failed to load findings');
    }
  },

  /** Change a finding's disposition through the Operation log, then re-analyze. */
  disposeFinding: async (fingerprint, status, previousStatus) => {
    const project = get().project;
    if (!project) return;
    const response = await apiSetFindingStatus(project.id, fingerprint, status, previousStatus);
    set({ availability: response.availability, watermark: response.watermark });
    get().invalidateOperationLog();
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

  revealSecret: async (secretId) => {
    const project = get().project;
    if (!project) throw new Error('no project');
    let value: string;
    try {
      ({ value } = await apiFetch(
        `/projects/${project.id}/secrets/${secretId}/reveal`,
        z.object({ value: z.string() }),
        { method: 'POST', body: '{}' },
      ));
    } catch (error) {
      get().pushToast(error instanceof Error ? error.message : 'Reveal failed');
      throw error;
    }
    // the reveal flag moved server-side; refresh so the audit + state reflect it
    await get().reload();
    return value;
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
          watermark: response.watermark,
          ...(pending === 0 ? { graph: response.state, lastSavedAt: Date.now() } : {}),
        });
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Sync failed';
        get().pushToast(message);
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
    set({
      graph: response.state,
      availability: response.availability,
      watermark: response.watermark,
      lastSavedAt: Date.now(),
    });
  },

  redo: async () => {
    const project = get().project;
    if (!project || !get().availability.canRedo) return;
    const response = await postRedo(project.id);
    set({
      graph: response.state,
      availability: response.availability,
      watermark: response.watermark,
      lastSavedAt: Date.now(),
    });
  },

  select: (selection) => set({ selection }),

  /** Restore a .netplan bundle (ADR-0016) and switch to the imported project. */
  importBundle: async (bundleText) => {
    const bundle = netplanBundleSchema.parse(JSON.parse(bundleText));
    // switching projects supersedes any in-flight import poll (#110 D6)
    importPollGeneration += 1;
    const project = await apiFetch('/projects/import', projectSchema, {
      method: 'POST',
      body: JSON.stringify(bundle),
    });
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

  toggleFindingsLayer: () => set({ layers: { ...get().layers, findings: !get().layers.findings } }),

  focusFindingsForDevice: (deviceId) =>
    set(
      deviceId
        ? { view: 'findings', findingsDeviceFilter: deviceId }
        : { findingsDeviceFilter: null },
    ),

  setView: (view) => set({ view }),

  setCanvasMode: (mode) => set({ canvasMode: mode }),

  toggleGrid: () => set({ gridEnabled: !get().gridEnabled }),

  setHotkeyCardEnabled: (enabled) => {
    try {
      localStorage.setItem(HOTKEY_CARD_PREF_KEY, enabled ? 'on' : 'off');
    } catch {
      // storage unavailable — the preference just won't survive a reload
    }
    set({ hotkeyCardEnabled: enabled });
  },

  focusRule: (ruleId) => set({ contextTab: 'rules', focusedRuleId: ruleId }),

  focusFinding: (fingerprint) => set({ view: 'findings', focusedFindingFingerprint: fingerprint }),

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
    // Generation guard (#110 D6): starting another import supersedes this
    // poll — a stale loop must never overwrite the newer job's view state.
    const generation = ++importPollGeneration;
    try {
      const job = await createImport(project.id, input);
      if (generation !== importPollGeneration) return;
      set({ importJobs: [...get().importJobs, job] });
      // poll the background worker until it leaves pending/parsing
      for (let attempt = 0; attempt < 100; attempt++) {
        const detail = await getImportDetail(project.id, job.id);
        if (generation !== importPollGeneration) return;
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
      if (generation === importPollGeneration) {
        get().pushToast('Import is still parsing — check the job list.', 'info');
      }
    } catch (error) {
      if (generation !== importPollGeneration) return;
      get().pushToast(error instanceof Error ? error.message : 'Import failed');
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
    try {
      const proposal = await resolveImportConflict(project.id, selected.job.id, conflictId, action);
      set({ selectedImport: { ...selected, proposal } });
    } catch (error) {
      get().pushToast(error instanceof Error ? error.message : 'Resolve failed');
    }
  },

  commitSelectedImport: async () => {
    const project = get().project;
    const selected = get().selectedImport;
    if (!project || !selected) return;
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
        // committed/rolled-back evidence changes the detection surface (M5, #62)
        findings: null,
      });
    } catch (error) {
      get().pushToast(error instanceof Error ? error.message : 'Commit failed');
    }
  },

  rollbackSelectedImport: async () => {
    const project = get().project;
    const selected = get().selectedImport;
    if (!project || !selected) return;
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
        // committed/rolled-back evidence changes the detection surface (M5, #62)
        findings: null,
      });
    } catch (error) {
      get().pushToast(error instanceof Error ? error.message : 'Rollback failed');
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

  toggleConnectMode: () => set({ connectMode: !get().connectMode, connectDraft: emptyDraft }),

  connectPickNode: (nodeType, nodeId) => {
    if (!get().connectMode) return;
    if (nodeType !== 'device') {
      get().pushToast(
        `A Link cannot terminate on a ${nodeType} — endpoints must be Interfaces.`,
        'info',
      );
      return;
    }
    const graph = get().graph;
    const draft = get().connectDraft;
    const firstInterface = graph?.interfaces.find((i) => i.deviceId === nodeId)?.id ?? null;
    if (!draft.sourceDeviceId) {
      set({
        connectDraft: { ...draft, sourceDeviceId: nodeId, sourceInterfaceId: firstInterface },
      });
    } else if (nodeId !== draft.sourceDeviceId) {
      set({
        connectDraft: { ...draft, targetDeviceId: nodeId, targetInterfaceId: firstInterface },
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

  resetConnectDraft: () => set({ connectDraft: emptyDraft }),
}));
