import type { EvidenceId } from '../../imports.js';
import type { HostSecurityInventory } from '../inputs.js';

/** A path-bearing artifact drawn from a host inventory (file, process or persistence entry). */
export interface PathCandidate {
  path: string;
  filename: string;
  sha256: string | null;
  source: 'file' | 'process' | 'persistence';
}

/** The final path segment, tolerating both `\` and `/` separators. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Lowercased extensions of a filename, in order (e.g. `a.pdf.exe` → ['pdf','exe']). */
export function extensions(filename: string): string[] {
  const dot = filename.indexOf('.');
  if (dot < 0) return [];
  return filename
    .slice(dot + 1)
    .toLowerCase()
    .split('.')
    .filter((s) => s.length > 0);
}

/** Every path-bearing artifact in an inventory, normalized to a common shape. */
export function pathCandidates(inventory: HostSecurityInventory): PathCandidate[] {
  const out: PathCandidate[] = [];
  for (const file of inventory.files) {
    out.push({
      path: file.path,
      filename: basename(file.path),
      sha256: file.sha256,
      source: 'file',
    });
  }
  for (const proc of inventory.processes) {
    if (proc.path) {
      out.push({ path: proc.path, filename: basename(proc.path), sha256: null, source: 'process' });
    }
  }
  for (const entry of inventory.persistence) {
    if (entry.path) {
      out.push({
        path: entry.path,
        filename: basename(entry.path),
        sha256: null,
        source: 'persistence',
      });
    }
  }
  return out;
}

/** The evidence references for a finding built from an inventory. */
export function inventoryEvidence(inventory: HostSecurityInventory): EvidenceId[] {
  return inventory.evidenceId ? [inventory.evidenceId] : [];
}

export function includesInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
