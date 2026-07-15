import type { Baseline, Device } from '../../entities.js';
import type { Endpoint, FlowEndpoint } from '../../endpoints.js';
import type { EvidenceId } from '../../imports.js';
import type { ProjectState } from '../../state.js';
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

/** Locations legitimate software rarely launches from (shared by M5 and M6). */
export const SUSPECT_LOCATIONS: readonly string[] = [
  '\\temp\\',
  '/tmp/',
  '\\tmp\\',
  '\\downloads\\',
  '/downloads/',
  'appdata\\local\\temp',
  '\\$recycle',
  '/dev/shm/',
  '\\programdata\\temp',
  '\\users\\public\\',
];

export function isSuspectLocation(text: string, extra: readonly string[] = []): boolean {
  return [...SUSPECT_LOCATIONS, ...extra].some((loc) => includesInsensitive(text, loc));
}

/** Networks a device's interfaces are members of. */
export function deviceNetworkIds(state: ProjectState, device: Device): Set<string> {
  const ids = new Set<string>();
  for (const iface of state.interfaces) {
    if (iface.deviceId === device.id && iface.networkId) ids.add(iface.networkId);
  }
  return ids;
}

/** Baselines whose scope governs this device (the device, its zone, or its networks). */
export function applicableBaselines(state: ProjectState, device: Device): Baseline[] {
  const networkIds = deviceNetworkIds(state, device);
  return state.baselines.filter((b) => {
    switch (b.scope.kind) {
      case 'device':
        return b.scope.id === device.id;
      case 'zone':
        return device.zoneId != null && b.scope.id === device.zoneId;
      case 'network':
        return networkIds.has(b.scope.id);
    }
  });
}

/** The known Device a flow endpoint resolves to, or undefined — never fabricated. */
export function flowEndpointDevice(state: ProjectState, ep: FlowEndpoint): Device | undefined {
  if (ep.kind === 'device') return state.devices.find((d) => d.id === ep.id);
  if (ep.kind === 'interface') {
    const iface = state.interfaces.find((i) => i.id === ep.id);
    return iface ? state.devices.find((d) => d.id === iface.deviceId) : undefined;
  }
  return undefined;
}

/** Does a PolicyRule endpoint resolve to (cover) this device — directly, by zone, or by network? */
export function endpointCoversDevice(state: ProjectState, ep: Endpoint, device: Device): boolean {
  switch (ep.kind) {
    case 'device':
      return ep.id === device.id;
    case 'zone':
      return device.zoneId != null && ep.id === device.zoneId;
    case 'interface':
      return state.interfaces.some((i) => i.id === ep.id && i.deviceId === device.id);
    case 'network':
    case 'subnet':
      return deviceNetworkIds(state, device).has(ep.id);
  }
}

/** Is there an intended `allow` PolicyRule sanctioning traffic between two devices? */
export function policyAllows(state: ProjectState, src: Device, dst: Device): boolean {
  return state.policyRules.some((rule) => {
    if (rule.action !== 'allow') return false;
    const forward =
      endpointCoversDevice(state, rule.source, src) &&
      endpointCoversDevice(state, rule.destination, dst);
    const reverse =
      rule.direction === 'bidirectional' &&
      endpointCoversDevice(state, rule.source, dst) &&
      endpointCoversDevice(state, rule.destination, src);
    return forward || reverse;
  });
}

/** Read a numeric rule-config param, falling back to a default. */
export function numberParam(
  params: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
