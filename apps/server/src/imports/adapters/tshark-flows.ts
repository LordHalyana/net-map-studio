import { z } from 'zod';
import type { ObservationDraft, Protocol } from '@netplan/domain';
import { guardedJsonParse, ParseLimitError } from '../guards.js';
import type { Adapter, AdapterContext } from './types.js';

/**
 * tshark flow-summary Adapter (ADR-0019/0020, plan M6): JSON or CSV
 * conversation summaries → aggregated Flow observations. Pre-aggregation
 * happens HERE, per (source, destination, service), so an SMB-scale capture
 * (~100k conversations) reaches the pipeline as a few thousand claims and the
 * canvas as bundled edges. Rows are processed in chunks with event-loop
 * yields — parsing never blocks the API.
 */

const conversationSchema = z.looseObject({
  source: z.string().min(1),
  destination: z.string().min(1),
  protocol: z.string().default('tcp'),
  port: z.coerce.number().int().min(0).max(65535).nullable().default(null),
  frames: z.coerce.number().int().min(1).default(1),
  firstSeen: z.union([z.string(), z.number()]).optional(),
  lastSeen: z.union([z.string(), z.number()]).optional(),
});
type Conversation = z.infer<typeof conversationSchema>;

const CHUNK_SIZE = 5000;

function toProtocol(value: string): Protocol {
  const lower = value.toLowerCase();
  if (lower === 'tcp' || lower === 'udp' || lower === 'icmp') return lower;
  return 'other';
}

/** Accept ISO strings or epoch seconds (tshark's -e frame.time_epoch style). */
function toIso(value: string | number | undefined): string | null {
  if (value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(value)) {
    return new Date(Number(value) * 1000).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const IP_SHAPE = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-fA-F:]+:[0-9a-fA-F:]*)$/;

function endpointHints(value: string): { ip: string } | { hostname: string } {
  return IP_SHAPE.test(value) ? { ip: value } : { hostname: value };
}

function parseCsv(content: string): Conversation[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [headerLine, ...rows] = lines;
  if (!headerLine) throw new ParseLimitError('Empty CSV flow summary');
  const header = headerLine.split(',').map((h) => h.trim());
  const required = ['source', 'destination'];
  if (!required.every((column) => header.includes(column))) {
    throw new ParseLimitError(
      `CSV flow summary needs at least columns ${required.join(', ')} — got ${headerLine}`,
    );
  }
  return rows.map((row) => {
    const cells = row.split(',');
    const record: Record<string, string> = {};
    header.forEach((column, i) => {
      const cell = cells[i]?.trim();
      if (cell !== undefined && cell !== '') record[column] = cell;
    });
    return conversationSchema.parse(record);
  });
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

export const tsharkFlowsAdapter: Adapter = {
  name: 'tshark-flows',
  version: '1.0.0',
  schemaVersion: 'tshark-flow-summary',
  async parse(content: string, ctx: AdapterContext): Promise<ObservationDraft[]> {
    const trimmed = content.trimStart();
    let conversations: Conversation[];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const parsed = guardedJsonParse(content, ctx.limits);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      conversations = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        ctx.budget.check();
        for (const row of rows.slice(i, i + CHUNK_SIZE)) {
          conversations.push(conversationSchema.parse(row));
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    } else {
      conversations = parseCsv(content);
    }

    // aggregation: one record per (source, destination, service) — ADR-0020
    const aggregates = new Map<string, Aggregate>();
    for (let i = 0; i < conversations.length; i += CHUNK_SIZE) {
      ctx.budget.check();
      for (const row of conversations.slice(i, i + CHUNK_SIZE)) {
        const protocol = toProtocol(row.protocol);
        const key = `${row.source}->${row.destination}:${protocol}/${row.port ?? 'any'}`;
        const firstSeen = toIso(row.firstSeen);
        const lastSeen = toIso(row.lastSeen);
        const entry = aggregates.get(key);
        if (!entry) {
          aggregates.set(key, {
            source: row.source,
            destination: row.destination,
            protocol,
            port: row.port,
            count: row.frames,
            firstSeen,
            lastSeen,
          });
        } else {
          entry.count += row.frames;
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
      // traffic without endpoint identity is a low-to-medium contributor (§3.7)
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
