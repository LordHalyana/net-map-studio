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
  /** Zod's toJSONSchema may dedupe structurally-identical schemas into refs. */
  $ref?: string;
  $defs?: Record<string, SchemaNode>;
}

const DEFS_PREFIX = '#/$defs/';

/**
 * Resolve `$ref` nodes against the root's `$defs` (#110 B4). Zod's
 * `toJSONSchema` may dedupe structurally-identical schemas (the package /
 * remote-access twins are exactly the trigger shape) — without this the field
 * table would silently drop every deduped branch. Local siblings (e.g. a
 * `description` next to the `$ref`) override the referenced definition, and an
 * unresolvable ref throws rather than truncating the table.
 */
function makeResolve(root: SchemaNode): (node: SchemaNode) => SchemaNode {
  const defs = root.$defs ?? {};
  return function resolve(node: SchemaNode): SchemaNode {
    if (node.$ref === undefined) return node;
    const target = node.$ref.startsWith(DEFS_PREFIX)
      ? defs[node.$ref.slice(DEFS_PREFIX.length)]
      : undefined;
    if (!target) throw new Error(`Unresolvable $ref in device-state schema: ${node.$ref}`);
    const overrides = { ...node };
    delete overrides.$ref;
    return { ...resolve(target), ...overrides };
  };
}

/** Bounds this wide are Zod's safe-integer sentinels, not real constraints. */
const INT_SENTINEL = 9_007_199_254_740_991;

function literalLabel(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? 'unknown');
}

function typeLabel(node: SchemaNode): string {
  if (node.const !== undefined) return `"${literalLabel(node.const)}" (exactly)`;
  if (node.enum) return node.enum.map((value) => `'${literalLabel(value)}'`).join(' | ');
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

type Resolve = (node: SchemaNode) => SchemaNode;

function walk(
  raw: SchemaNode,
  path: string,
  required: boolean,
  out: ImportFormatField[],
  resolve: Resolve,
): void {
  const node = resolve(raw);
  if (node.type === 'array' && node.items) {
    const items = resolve(node.items);
    const name = `${path}[]`;
    const description = node.description ?? items.description ?? '';
    if (hasProperties(items)) {
      out.push({ name, type: 'object', required, description });
      walkProperties(items, name, out, resolve);
    } else {
      out.push({ name, type: typeLabel(items), required, description });
    }
    return;
  }
  if (hasProperties(node)) {
    out.push({ name: path, type: 'object', required, description: node.description ?? '' });
    walkProperties(node, path, out, resolve);
    return;
  }
  out.push({ name: path, type: typeLabel(node), required, description: node.description ?? '' });
}

function walkProperties(
  node: SchemaNode,
  prefix: string,
  out: ImportFormatField[],
  resolve: Resolve,
): void {
  const requiredKeys = new Set(node.required ?? []);
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    walk(child, prefix === '' ? key : `${prefix}.${key}`, requiredKeys.has(key), out, resolve);
  }
}

function isSchemaNode(value: unknown): value is SchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walk any generated JSON-Schema object into the field table (exported for tests). */
export function formatFieldsFromSchema(schema: unknown): ImportFormatField[] {
  if (!isSchemaNode(schema)) throw new Error('JSON schema root is not an object');
  const out: ImportFormatField[] = [];
  walkProperties(schema, '', out, makeResolve(schema));
  return out;
}

/** The device-state contract as a field table — generated, never hand-written. */
export function deviceStateFormatFields(): ImportFormatField[] {
  return formatFieldsFromSchema(deviceStateJsonSchema());
}
