import { z } from 'zod';
import {
  deviceCoverageSchema,
  findingViewSchema,
  newId,
  operationIdSchema,
  projectIdSchema,
  type FindingStatus,
  type MutationResponse,
} from '@netplan/domain';
import { postOperation } from './client';

export const findingsReportSchema = z.object({
  findings: z.array(findingViewSchema),
  coverage: z.array(deviceCoverageSchema),
  opSeq: z.number().int(),
  configHash: z.string(),
});
export type FindingsReport = z.infer<typeof findingsReportSchema>;

const BASE = '/api';

export async function getFindings(projectId: string): Promise<FindingsReport> {
  const response = await fetch(`${BASE}/projects/${projectId}/findings`, {
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Failed to load findings: ${response.status}`);
  return findingsReportSchema.parse(await response.json());
}

/** Disposition mutations flow through the Operation log (ADR-0023), keyed by fingerprint. */
export function setFindingStatus(
  projectId: string,
  fingerprint: string,
  status: FindingStatus,
  previousStatus: FindingStatus,
): Promise<MutationResponse> {
  return postOperation(projectId, {
    id: newId(operationIdSchema),
    projectId: projectIdSchema.parse(projectId),
    kind: 'SetFindingStatus',
    fingerprint,
    status,
    previousStatus,
  });
}

export function setFindingNote(
  projectId: string,
  fingerprint: string,
  note: string,
  previousNote: string,
): Promise<MutationResponse> {
  return postOperation(projectId, {
    id: newId(operationIdSchema),
    projectId: projectIdSchema.parse(projectId),
    kind: 'SetFindingNote',
    fingerprint,
    note,
    previousNote,
  });
}
