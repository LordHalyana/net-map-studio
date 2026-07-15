import { z } from 'zod';
import type { ObservationDraft, Protocol } from '@netplan/domain';
import { ParseLimitError } from '../guards.js';
import type { Adapter, AdapterContext } from './types.js';

/**
 * P4-M4 — Zeek `conn.log` flow adapter (ADR-0019/0020): higher-fidelity flow
 * evidence than the tshark summary, dropping into the same
 * (source, destination, service) aggregation and reconciliation. Accepts both
 * classic TSV (`#fields …`) and JSON-lines conn logs. Pre-aggregation happens
 * here, so an SMB-scale log (~100k connections) reaches the pipeline as a few
 * thousand claims — the ADR-0019 aggregation ceiling. Hermetic: no egress.
 *
 * NetFlow-IPFIX / nfdump exports are additive later behind this same
 * flow-claim shape (plan §4) — do not build them here.
 */

interface ConnRow {
  origHost: string;
  respHost: string;
  respPort: number | null;
  proto: Protocol;
  /** Epoch seconds. */
  ts: number | null;
  durationSeconds: number;
}

const CHUNK_SIZE = 5000;
const UNSET = new Set(['-', '(empty)', '']);

function toProtocol(value: string | undefined): Protocol {
  const lower = (value ?? '').toLowerCase();
  if (lower === 'tcp' || lower === 'udp' || lower === 'icmp') return lower;
  return 'other';
}

function toPort(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 65535) return null;
  return num;
}

function toNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function rowFrom(record: Record<string, unknown>): ConnRow | null {
  const origHost = record['id.orig_h'];
  const respHost = record['id.resp_h'];
  if (typeof origHost !== 'string' || typeof respHost !== 'string') return null;
  if (origHost.length === 0 || respHost.length === 0) return null;
  return {
    origHost,
    respHost,
    respPort: toPort(record['id.resp_p']),
    proto: toProtocol(typeof record.proto === 'string' ? record.proto : undefined),
    ts: toNumber(record.ts),
    durationSeconds: toNumber(record.duration) ?? 0,
  };
}

/** Classic Zeek TSV: `#fields`/`#types` headers, tab-separated rows, `-` unset. */
function parseTsv(content: string, ctx: AdapterContext): ConnRow[] {
  let fields: string[] | null = null;
  const rows: ConnRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    ctx.budget.check();
    if (line.length === 0) continue;
    if (line.startsWith('#')) {
      if (line.startsWith('#fields')) fields = line.split('\t').slice(1);
      continue;
    }
    if (!fields) throw new ParseLimitError('Zeek TSV conn.log has data before its #fields header');
    const cells = line.split('\t');
    const record: Record<string, string | undefined> = {};
    fields.forEach((field, i) => {
      const cell = cells[i];
      record[field] = cell === undefined || UNSET.has(cell) ? undefined : cell;
    });
    const row = rowFrom(record);
    if (row) rows.push(row);
  }
  if (!fields) throw new ParseLimitError('Not a Zeek conn.log: no #fields header found');
  return rows;
}

/** JSON-lines conn.log (`zeek LogAscii::use_json=T`): one object per line. */
function parseJsonLines(content: string, ctx: AdapterContext): ConnRow[] {
  const rows: ConnRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    ctx.budget.check();
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON-lines conn.log entry: ${line.slice(0, 80)}`);
    }
    const record = z.record(z.string(), z.unknown()).safeParse(parsed);
    if (!record.success) continue;
    const row = rowFrom(record.data);
    if (row) rows.push(row);
  }
  return rows;
}

interface Aggregate {
  source: string;
  destination: string;
  protocol: Protocol;
  port: number | null;
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

function toIso(epochSeconds: number | null): string | null {
  return epochSeconds === null ? null : new Date(epochSeconds * 1000).toISOString();
}

const IP_SHAPE = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-fA-F:]+:[0-9a-fA-F:]*)$/;

function endpointHints(value: string): { ip: string } | { hostname: string } {
  return IP_SHAPE.test(value) ? { ip: value } : { hostname: value };
}

export const zeekConnAdapter: Adapter = {
  name: 'zeek-conn',
  version: '1.0.0',
  schemaVersion: 'zeek-conn-log',
  async parse(content: string, ctx: AdapterContext): Promise<ObservationDraft[]> {
    const rows = content.trimStart().startsWith('{')
      ? parseJsonLines(content, ctx)
      : parseTsv(content, ctx);

    // aggregation: one record per (source, destination, service) — ADR-0020;
    // each conn.log row is one connection, so count is the connection count
    const aggregates = new Map<string, Aggregate>();
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      ctx.budget.check();
      for (const row of rows.slice(i, i + CHUNK_SIZE)) {
        const key = `${row.origHost}->${row.respHost}:${row.proto}/${row.respPort ?? 'any'}`;
        const firstSeen = toIso(row.ts);
        const lastSeen = toIso(row.ts === null ? null : row.ts + row.durationSeconds);
        const entry = aggregates.get(key);
        if (!entry) {
          aggregates.set(key, {
            source: row.origHost,
            destination: row.respHost,
            protocol: row.proto,
            port: row.respPort,
            count: 1,
            firstSeen,
            lastSeen,
          });
        } else {
          entry.count += 1;
          if (firstSeen && (!entry.firstSeen || firstSeen < entry.firstSeen)) {
            entry.firstSeen = firstSeen;
          }
          if (lastSeen && (!entry.lastSeen || lastSeen > entry.lastSeen)) {
            entry.lastSeen = lastSeen;
          }
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }

    return [...aggregates.values()].map((aggregate) => ({
      contributor: 'trafficObservation',
      observedAt: aggregate.lastSeen,
      claim: {
        targetKind: 'flow',
        source: endpointHints(aggregate.source),
        destination: endpointHints(aggregate.destination),
        protocol: aggregate.protocol,
        port: aggregate.port,
        firstSeen: aggregate.firstSeen,
        lastSeen: aggregate.lastSeen,
        count: aggregate.count,
      },
    }));
  },
};
