import { z } from 'zod';
import {
  evidenceSchema,
  fieldProvenanceSchema,
  importJobSchema,
  importProposalSchema,
  mutationResponseSchema,
  observationSchema,
  projectStateSchema,
  type Evidence,
  type FieldProvenance,
  type ImportJob,
  type ImportProposal,
  type ImportResolutionAction,
  type MutationResponse,
  type Observation,
  type ProjectState,
} from '@netplan/domain';

/** Import-pipeline API surface (ADR-0019/0021) — same conventions as client.ts. */

const BASE = '/api';

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
    throw new Error(message);
  }
  return schema.parse(await response.json());
}

export const importJobDetailSchema = z.object({
  job: importJobSchema,
  evidence: z.array(evidenceSchema),
  observations: z.array(observationSchema),
  proposal: importProposalSchema.nullable(),
});
export type ImportJobDetail = z.infer<typeof importJobDetailSchema>;

const commitResponseSchema = importJobDetailSchema.extend({ state: projectStateSchema });
export type ImportCommitResponse = z.infer<typeof commitResponseSchema>;

export interface UploadImportInput {
  filename: string;
  adapter: string;
  content: string;
  /** ImportProfile for profile-driven adapters like netcat-text (#90 A4). */
  profileId?: string;
}

export const createImport = (projectId: string, input: UploadImportInput): Promise<ImportJob> =>
  api(`/projects/${projectId}/imports`, importJobSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const listImports = (projectId: string): Promise<ImportJob[]> =>
  api(`/projects/${projectId}/imports`, z.array(importJobSchema));

export const getImportDetail = (projectId: string, jobId: string): Promise<ImportJobDetail> =>
  api(`/projects/${projectId}/imports/${jobId}`, importJobDetailSchema);

export const resolveImportConflict = (
  projectId: string,
  jobId: string,
  conflictId: string,
  action: ImportResolutionAction,
): Promise<ImportProposal> =>
  api(`/projects/${projectId}/imports/${jobId}/resolve`, importProposalSchema, {
    method: 'POST',
    body: JSON.stringify({ conflictId, action }),
  });

export const commitImport = (projectId: string, jobId: string): Promise<ImportCommitResponse> =>
  api(`/projects/${projectId}/imports/${jobId}/commit`, commitResponseSchema, {
    method: 'POST',
    body: '{}',
  });

export const rollbackImport = (projectId: string, jobId: string): Promise<ImportCommitResponse> =>
  api(`/projects/${projectId}/imports/${jobId}/rollback`, commitResponseSchema, {
    method: 'POST',
    body: '{}',
  });

// Worker control (P4-M5): cancel a queued/running parse, resume a cancelled one.
export const cancelImport = (projectId: string, jobId: string): Promise<ImportJob> =>
  api(`/projects/${projectId}/imports/${jobId}/cancel`, importJobSchema, {
    method: 'POST',
    body: '{}',
  });

export const resumeImport = (projectId: string, jobId: string): Promise<ImportJob> =>
  api(`/projects/${projectId}/imports/${jobId}/resume`, importJobSchema, {
    method: 'POST',
    body: '{}',
  });

export const listProjectProvenance = (projectId: string): Promise<FieldProvenance[]> =>
  api(`/projects/${projectId}/provenance`, z.array(fieldProvenanceSchema));

export const listEvidence = (projectId: string): Promise<Evidence[]> =>
  api(`/projects/${projectId}/evidence`, z.array(evidenceSchema));

const evidenceBlobSchema = z.object({
  record: evidenceSchema,
  encoding: z.enum(['utf8', 'base64']),
  content: z.string(),
});
export type EvidenceBlob = z.infer<typeof evidenceBlobSchema>;

export const getEvidenceBlob = (projectId: string, evidenceId: string): Promise<EvidenceBlob> =>
  api(`/projects/${projectId}/evidence/${evidenceId}`, evidenceBlobSchema);

export const overrideField = (
  projectId: string,
  input: { entityType: string; entityId: string; field: string; value: unknown },
): Promise<MutationResponse> =>
  api(`/projects/${projectId}/provenance/override`, mutationResponseSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export type { Evidence, FieldProvenance, ImportJob, ImportProposal, Observation, ProjectState };
