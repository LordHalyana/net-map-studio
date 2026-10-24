import { z } from 'zod';
import {
  changeSetRecordSchema,
  mutationResponseSchema,
  operationLogEntrySchema,
  projectSchema,
  projectStateSchema,
  undoRedoAvailabilitySchema,
  type ChangeSet,
  type ChangeSetRecord,
  type MutationResponse,
  type Operation,
  type OperationLogEntry,
  type Project,
  type ProjectState,
  type UndoRedoAvailability,
} from '@netplan/domain';

/**
 * API root, relative to wherever the SPA is served. `BASE_URL` is Vite's
 * `base` (`/` by default, a subpath such as `/netplan-studio/app/` when the
 * app is hosted under one), so this stays `/api` for the normal setups.
 */
export const API_BASE = `${import.meta.env.BASE_URL}api`;
const BASE = API_BASE;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The one fetch path of the web client (#110 D1): JSON round-trip, server
 * error message extraction, `ApiError` carrying the HTTP status, and a Zod
 * parse on the way in. Every API module and the store call this — never
 * `fetch` directly — so error shape and status propagate identically no
 * matter which panel made the call.
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        message = body.error;
      }
    } catch {
      // keep default message
    }
    throw new ApiError(response.status, message);
  }
  return schema.parse(await response.json());
}

export const listProjects = (): Promise<Project[]> => apiFetch('/projects', z.array(projectSchema));

export const createProject = (name: string): Promise<Project> =>
  apiFetch('/projects', projectSchema, { method: 'POST', body: JSON.stringify({ name }) });

export const getGraph = (projectId: string): Promise<ProjectState> =>
  apiFetch(`/projects/${projectId}/graph`, projectStateSchema);

export const postOperation = (
  projectId: string,
  payload: Operation | ChangeSet,
): Promise<MutationResponse> =>
  apiFetch(`/projects/${projectId}/operations`, mutationResponseSchema, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const getLog = (projectId: string): Promise<OperationLogEntry[]> =>
  apiFetch(`/projects/${projectId}/log`, z.array(operationLogEntrySchema));

export const getAvailability = (projectId: string): Promise<UndoRedoAvailability> =>
  apiFetch(`/projects/${projectId}/availability`, undoRedoAvailabilitySchema);

// note: body must be present — a bare POST with a JSON content-type is rejected
export const postUndo = (projectId: string): Promise<MutationResponse> =>
  apiFetch(`/projects/${projectId}/undo`, mutationResponseSchema, { method: 'POST', body: '{}' });

export const postRedo = (projectId: string): Promise<MutationResponse> =>
  apiFetch(`/projects/${projectId}/redo`, mutationResponseSchema, { method: 'POST', body: '{}' });

// Proposal ChangeSets (P4-M6): register a draft shell, list review states.
// Status transitions travel as SetChangeSetReviewStatus via postOperation.
export const listChangeSets = (projectId: string): Promise<ChangeSetRecord[]> =>
  apiFetch(`/projects/${projectId}/changesets`, z.array(changeSetRecordSchema));

export const registerChangeSet = (projectId: string, label: string): Promise<ChangeSetRecord> =>
  apiFetch(`/projects/${projectId}/changesets`, changeSetRecordSchema, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
