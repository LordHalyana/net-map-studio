import type { DeviceHints, FlowEndpointHints, Observation, ObservationClaim } from '../imports.js';

/**
 * Normalization stage (ADR-0020): canonical forms for MACs, IPs and
 * hostnames, so deduplication compares like with like. Unrecognizable values
 * pass through untouched — normalization never guesses.
 */

const MAC_SEPARATORS = /[:.\-\s]/g;

export function normalizeMac(value: string): string {
  const hex = value.replace(MAC_SEPARATORS, '').toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex)) return value;
  return hex.replace(/(..)(?!$)/g, '$1:');
}

function normalizeIpv4(value: string): string | null {
  const octets = value.split('.');
  if (octets.length !== 4) return null;
  const parsed = octets.map((o) => (/^\d{1,3}$/.test(o) ? Number(o) : NaN));
  if (parsed.some((n) => Number.isNaN(n) || n > 255)) return null;
  return parsed.join('.');
}

function normalizeIpv6(value: string): string | null {
  if (!value.includes(':') || !/^[0-9a-fA-F:.]+$/.test(value)) return null;
  const lower = value.toLowerCase();
  // expand :: to the full eight groups
  const [head = '', tail = ''] = lower.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const hasCompression = lower.includes('::');
  const missing = 8 - headGroups.length - tailGroups.length;
  if (hasCompression ? missing < 1 : headGroups.length !== 8) return null;
  const groups = hasCompression
    ? [...headGroups, ...Array.from({ length: missing }, () => '0'), ...tailGroups]
    : headGroups;
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const trimmed = groups.map((g) => g.replace(/^0+(?=.)/, ''));
  // re-compress the longest zero run (leftmost on ties), per RFC 5952
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== '0') continue;
    let j = i;
    while (j < trimmed.length && trimmed[j] === '0') j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  if (bestLength < 2) return trimmed.join(':');
  const before = trimmed.slice(0, bestStart).join(':');
  const after = trimmed.slice(bestStart + bestLength).join(':');
  return `${before}::${after}`;
}

export function normalizeIp(value: string): string {
  return normalizeIpv4(value) ?? normalizeIpv6(value) ?? value;
}

export function normalizeHostname(value: string): string {
  return value.toLowerCase().replace(/\.$/, '');
}

function normalizeHints(hints: DeviceHints): DeviceHints {
  return {
    ...hints,
    ...(hints.mac !== undefined ? { mac: normalizeMac(hints.mac) } : {}),
    ...(hints.ip !== undefined ? { ip: normalizeIp(hints.ip) } : {}),
    ...(hints.hostname !== undefined ? { hostname: normalizeHostname(hints.hostname) } : {}),
  };
}

function normalizeFlowEndpoint(hints: FlowEndpointHints): FlowEndpointHints {
  return {
    ...hints,
    ...(hints.mac !== undefined ? { mac: normalizeMac(hints.mac) } : {}),
    ...(hints.ip !== undefined ? { ip: normalizeIp(hints.ip) } : {}),
    ...(hints.hostname !== undefined ? { hostname: normalizeHostname(hints.hostname) } : {}),
  };
}

function normalizeAddressValue(kind: string, value: string): string {
  switch (kind) {
    case 'mac':
      return normalizeMac(value);
    case 'ipv4':
    case 'ipv6':
      return normalizeIp(value);
    case 'hostname':
      return normalizeHostname(value);
    default:
      return value;
  }
}

function normalizeClaim(claim: ObservationClaim): ObservationClaim {
  switch (claim.targetKind) {
    case 'device':
      return { ...claim, device: normalizeHints(claim.device) };
    case 'interface':
      return { ...claim, device: normalizeHints(claim.device) };
    case 'address':
      return {
        ...claim,
        device: normalizeHints(claim.device),
        value: normalizeAddressValue(claim.kind, claim.value),
      };
    case 'service':
      return { ...claim, device: normalizeHints(claim.device) };
    case 'flow':
      return {
        ...claim,
        source: normalizeFlowEndpoint(claim.source),
        destination: normalizeFlowEndpoint(claim.destination),
      };
    case 'identity':
      return {
        ...claim,
        // null host = directory-export claim (P4-M3); nothing to normalize
        device: claim.device === null ? null : normalizeHints(claim.device),
        // Domain/realm names are case-insensitive — canonicalize; the
        // principal's own name keeps its casing for display (Linux names
        // are case-sensitive), dedup keys fold case instead.
        identity: { ...claim.identity, domain: claim.identity.domain.toUpperCase() },
      };
    case 'roleAssignment':
      return {
        ...claim,
        device: normalizeHints(claim.device),
        identity: { ...claim.identity, domain: claim.identity.domain.toUpperCase() },
      };
    case 'hostArtifact':
      // names/paths keep their casing (Linux paths are case-sensitive);
      // only the host reference normalizes
      return { ...claim, device: normalizeHints(claim.device) };
  }
}

/** Pure: returns a normalized copy, the input Observation is untouched. */
export function normalizeObservation(observation: Observation): Observation {
  return { ...observation, claim: normalizeClaim(observation.claim) };
}
