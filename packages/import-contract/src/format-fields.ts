import { deviceStateJsonSchema } from './device-state.js';

/**
 * One row of the human-readable field table an import format shows in the
 * app's "Expected format" helper (#90 A0/A1). For the device-state contract
 * the rows are GENERATED from the Zod schema via its JSON-Schema artifact, so
 * the in-app table can never drift from the contract (ADR-0017/0018).
 */
export interface ImportFormatField {
  /** Dotted path, e.g. "hosts[].interfaces[].mac". */
  name: string;
  /** Human-readable type, e.g. "int 0–65535", "'tcp' | 'udp'". */
  type: string;
  required: boolean;
  description: string;
}

/** The subset of JSON Schema the generated device-state artifact uses. */
interface SchemaNode {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  format?: string;
  minimum?: number;
  maximum?: number;
  description?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
}

/** Bounds this wide are Zod's safe-integer sentinels, not real constraints. */
const INT_SENTINEL = 9_007_199_254_740_991;

function typeLabel(node: SchemaNode): string {
  if (node.const !== undefined) return `"${String(node.const)}" (exactly)`;
  if (node.enum) return node.enum.map((value) => `'${String(value)}'`).join(' | ');
  if (node.type === 'string') {
    return node.format === 'date-time' ? 'ISO 8601 timestamp' : 'string';
  }
  if (node.type === 'integer' || node.type === 'number') {
    const { minimum, maximum } = node;
    const bounded =
      minimum !== undefined &&
      maximum !== undefined &&
      Math.abs(minimum) < INT_SENTINEL &&
      Math.abs(maximum) < INT_SENTINEL;
    return bounded ? `int ${minimum}–${maximum}` : 'int';
  }
  if (node.type === 'boolean') return 'boolean';
  if (node.type === 'object') return 'object';
  return node.type ?? 'unknown';
}

function hasProperties(node: SchemaNode): boolean {
  return node.properties !== undefined && Object.keys(node.properties).length > 0;
}

function walk(node: SchemaNode, path: string, required: boolean, out: ImportFormatField[]): void {
  if (node.type === 'array' && node.items) {
    const name = `${path}[]`;
    const description = node.description ?? node.items.description ?? '';
    if (hasProperties(node.items)) {
      out.push({ name, type: 'object', required, description });
      walkProperties(node.items, name, out);
    } else {
      out.push({ name, type: typeLabel(node.items), required, description });
    }
    return;
  }
  if (hasProperties(node)) {
    out.push({ name: path, type: 'object', required, description: node.description ?? '' });
    walkProperties(node, path, out);
    return;
  }
  out.push({ name: path, type: typeLabel(node), required, description: node.description ?? '' });
}

function walkProperties(node: SchemaNode, prefix: string, out: ImportFormatField[]): void {
  const requiredKeys = new Set(node.required ?? []);
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    walk(child, prefix === '' ? key : `${prefix}.${key}`, requiredKeys.has(key), out);
  }
}

/** The device-state contract as a field table — generated, never hand-written. */
export function deviceStateFormatFields(): ImportFormatField[] {
  const out: ImportFormatField[] = [];
  walkProperties(deviceStateJsonSchema() as SchemaNode, '', out);
  return out;
}
