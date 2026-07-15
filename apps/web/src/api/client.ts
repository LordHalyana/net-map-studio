import { z } from 'zod';
import {
  mutationResponseSchema,
  projectSchema,
  projectStateSchema,
  type ChangeSet,
  type MutationResponse,
  type Operation,
  type Project,
  type ProjectState,
} from '@netplan/domain';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
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

export const listProjects = (): Promise<Project[]> => api('/projects', z.array(projectSchema));

export const createProject = (name: string): Promise<Project> =>
  api('/projects', projectSchema, { method: 'POST', body: JSON.stringify({ name }) });

export const getGraph = (projectId: string): Promise<ProjectState> =>
  api(`/projects/${projectId}/graph`, projectStateSchema);

export const postOperation = (
  projectId: string,
  payload: Operation | ChangeSet,
): Promise<MutationResponse> =>
  api(`/projects/${projectId}/operations`, mutationResponseSchema, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const postUndo = (projectId: string): Promise<MutationResponse> =>
  api(`/projects/${projectId}/undo`, mutationResponseSchema, { method: 'POST' });

export const postRedo = (projectId: string): Promise<MutationResponse> =>
  api(`/projects/${projectId}/redo`, mutationResponseSchema, { method: 'POST' });
