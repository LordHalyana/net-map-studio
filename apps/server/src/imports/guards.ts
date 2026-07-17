import { gunzipSync } from 'node:zlib';
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_OBSERVATIONS } from '@netplan/domain';
import { z } from 'zod';

/**
 * Worker resource limits (ADR-0019, design §3.13): a malformed or hostile
 * evidence file must be rejected by policy, never crash the app. Every limit
 * failure throws ParseLimitError, which the job runner turns into a `failed`
 * ImportJob.
 */
export interface ParseLimits {
  maxFileBytes: number;
  maxParseMillis: number;
  maxDepth: number;
  maxDecompressionRatio: number;
  /** Bound on observations one job may emit — a pathological capture fails, not the app (P4-M5). */
  maxObservations: number;
  /** How many parse jobs run at once; the rest queue (P4-M5). */
  maxConcurrentParses: number;
  /** Backpressure: queued + running jobs beyond this are rejected at ingest (P4-M5). */
  maxQueuedParses: number;
}

/** Validates ParseLimits crossing the worker process boundary (M12, #69). */
export const parseLimitsSchema = z.object({
  maxFileBytes: z.number(),
  maxParseMillis: z.number(),
  maxDepth: z.number(),
  maxDecompressionRatio: z.number(),
  maxObservations: z.number(),
  maxConcurrentParses: z.number(),
  maxQueuedParses: z.number(),
});

export const DEFAULT_PARSE_LIMITS: ParseLimits = {
  // file-size and observation ceilings live in @netplan/domain, next to the
  // format descriptors that document them to the user (#90 A0/A3)
  maxFileBytes: IMPORT_MAX_FILE_BYTES,
  maxParseMillis: 30_000,
  maxDepth: 64,
  maxDecompressionRatio: 100,
  maxObservations: IMPORT_MAX_OBSERVATIONS,
  maxConcurrentParses: 2,
  maxQueuedParses: 16,
};

export class ParseLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseLimitError';
  }
}

/** Thrown from inside a parse when the operator cancelled the job (P4-M5). */
export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`ImportJob ${jobId} was cancelled`);
    this.name = 'JobCancelledError';
  }
}

/**
 * Cooperative execution budget: adapters call `check()` between units of work
 * (per host, per row, per chunk), so a runaway parse fails by policy instead
 * of holding the process. The same checkpoints are where a cancellation
 * lands — `isCancelled` makes every budgeted adapter cancellable for free.
 */
export interface ParseBudget {
  check(): void;
}

export function startBudget(
  limits: ParseLimits,
  now: () => number = Date.now,
  cancellation?: { jobId: string; isCancelled: () => boolean },
): ParseBudget {
  const startedAt = now();
  return {
    check() {
      if (cancellation?.isCancelled()) {
        throw new JobCancelledError(cancellation.jobId);
      }
      const elapsed = now() - startedAt;
      if (elapsed > limits.maxParseMillis) {
        throw new ParseLimitError(
          `Parse exceeded the ${limits.maxParseMillis}ms execution budget after ${elapsed}ms`,
        );
      }
    },
  };
}

export function checkFileSize(sizeBytes: number, limits: ParseLimits): void {
  if (sizeBytes > limits.maxFileBytes) {
    throw new ParseLimitError(
      `File of ${sizeBytes} bytes exceeds the ${limits.maxFileBytes}-byte limit`,
    );
  }
}

/** Decompress with an absolute output cap — the archive-bomb guard (§3.13). */
export function guardedGunzip(compressed: Buffer, limits: ParseLimits): Buffer {
  const cap = Math.min(limits.maxFileBytes, compressed.length * limits.maxDecompressionRatio);
  try {
    return gunzipSync(compressed, { maxOutputLength: cap });
  } catch (error) {
    throw new ParseLimitError(
      `Decompression rejected (output cap ${cap} bytes): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Depth-check a parsed JSON value iteratively — no recursion to blow the stack on. */
export function checkJsonDepth(value: unknown, limits: ParseLimits): void {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 1 }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    const { node, depth } = item;
    if (depth > limits.maxDepth) {
      throw new ParseLimitError(`JSON nesting exceeds the depth limit of ${limits.maxDepth}`);
    }
    if (Array.isArray(node)) {
      for (const child of node) stack.push({ node: child, depth: depth + 1 });
    } else if (node !== null && typeof node === 'object') {
      for (const child of Object.values(node)) stack.push({ node: child, depth: depth + 1 });
    }
  }
}

/**
 * JSON.parse guarded against pathological inputs: V8 throws RangeError on
 * absurdly deep documents — surface that as a limit failure, then verify the
 * configured depth cap on what did parse.
 */
export function guardedJsonParse(content: string, limits: ParseLimits): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ParseLimitError('JSON document is too deeply nested to parse');
    }
    throw error;
  }
  checkJsonDepth(parsed, limits);
  return parsed;
}
