import { netplanBundleSchema, type NetplanBundle } from '@netplan/domain';

export function downloadBlob(filename: string, blob: Blob): void {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export async function fetchBundle(projectId: string): Promise<NetplanBundle> {
  const response = await fetch(`/api/projects/${projectId}/export`);
  if (!response.ok) throw new Error(`Export failed: ${response.status}`);
  return netplanBundleSchema.parse(await response.json());
}

export async function downloadNetplanBundle(projectId: string, projectName: string): Promise<void> {
  const bundle = await fetchBundle(projectId);
  const safeName = projectName.replaceAll(/[^\w-]+/g, '_') || 'project';
  downloadBlob(
    `${safeName}.netplan`,
    new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
  );
}

export async function downloadCsv(projectId: string, entityType: string): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/export/csv/${entityType}`);
  if (!response.ok) throw new Error(`CSV export failed: ${response.status}`);
  downloadBlob(`${entityType}.csv`, new Blob([await response.text()], { type: 'text/csv' }));
}

export const EXPORT_IMAGE_EVENT = 'netplan:export-image';

/** The canvas owns the React Flow DOM; the command bar just asks for an image. */
export function requestImageExport(format: 'png' | 'svg'): void {
  window.dispatchEvent(new CustomEvent(EXPORT_IMAGE_EVENT, { detail: { format } }));
}
