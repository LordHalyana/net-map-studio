import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { observationDraftSchema, type ObservationDraft } from '@netplan/domain';
import type { Adapter, AdapterContext } from './adapters/types.js';
import { ParseLimitError, startBudget, type ParseLimits } from './guards.js';

/**
 * Adapter execution seam (§3.5; improvements M12, #69). Parsers are the one
 * place hostile input reaches the app, so the default runner executes them in
 * an isolated child process with a hard wall-clock kill and a V8 heap cap —
 * a malformed or hostile evidence file takes down the worker, never the app.
 * The cooperative `guards.ts` budget keeps running inside the worker as
 * defence-in-depth. Tests may inject the in-process runner for determinism.
 */
export interface AdapterRunInput {
  adapterName: string;
  content: string;
  /** Serialized ImportProfile for profile-driven adapters (§3.6); undefined otherwise. */
  profile?: unknown;
  limits: ParseLimits;
  /** Cooperative cancellation — honoured by the inline runner only. */
  isCancelled?: () => boolean;
}

export interface AdapterRunOk {
  ok: true;
  drafts: ObservationDraft[];
}
export interface AdapterRunFailure {
  ok: false;
  error: string;
  limit: boolean;
}
export type AdapterRunResult = AdapterRunOk | AdapterRunFailure;

const adapterRunResultSchema = z.union([
  z.object({ ok: z.literal(true), drafts: z.array(observationDraftSchema) }),
  z.object({ ok: z.literal(false), error: z.string(), limit: z.boolean() }),
]);

function parseResult(text: string): AdapterRunResult | null {
  try {
    const parsed = adapterRunResultSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type AdapterRunner = (input: AdapterRunInput) => Promise<ObservationDraft[]>;

/** Wall-clock grace past the cooperative budget before the hard kill. */
const HARD_KILL_GRACE_MS = 2_000;
/** V8 old-space cap for the worker; a runaway allocation kills it, not the app. */
const WORKER_MAX_OLD_MB = 512;

/**
 * How to launch the worker: under tsx/vitest this module is `.ts`, so the
 * worker runs with tsx loaded into node (which resolves the workspace TS
 * exactly like the dev server); the tsup build emits `dist/parse-worker.js`
 * beside `dist/index.js`, so production spawns plain node.
 *
 * Either way the spawned process *is* the worker. Not the tsx CLI: it runs
 * the script in a second node process, so the hard kill (SIGKILL, which it
 * can't relay) only ended the launcher and orphaned a worker still spinning
 * on the runaway parse — without the heap cap, which sat on the launcher (#117).
 */
function workerCommand(): { command: string; args: string[] } {
  const isTs = import.meta.url.endsWith('.ts');
  const heapFlag = `--max-old-space-size=${WORKER_MAX_OLD_MB}`;
  if (isTs) {
    // dev/test: one node process with tsx as its loader (workspace TS resolves)
    const workerFile = fileURLToPath(new URL('./parse-worker.ts', import.meta.url));
    const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    return { command: process.execPath, args: [heapFlag, '--import', tsxLoader, workerFile] };
  }
  // prod: the tsup build emits the worker somewhere under dist/; the bundled
  // runner chunk may not sit beside it, so probe the known layouts
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'parse-worker.js'),
    join(here, 'imports', 'parse-worker.js'),
    join(here, '..', 'imports', 'parse-worker.js'),
  ];
  const workerFile = candidates.find((path) => existsSync(path)) ?? candidates[0]!;
  return { command: process.execPath, args: [heapFlag, workerFile] };
}

export interface WorkerRunnerOptions {
  /** Test seam: observe each spawned worker process (e.g. to check it is gone after a kill). */
  onSpawn?: (child: ChildProcess) => void;
}

/** Run an adapter in an isolated worker process (the M12 default). */
export function createWorkerAdapterRunner(options: WorkerRunnerOptions = {}): AdapterRunner {
  return (input) =>
    new Promise<ObservationDraft[]>((resolve, reject) => {
      const { command, args } = workerCommand();
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      options.onSpawn?.(child);
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        fn();
      };

      const hardTimer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(() =>
          reject(
            new ParseLimitError(
              `Parse exceeded ${input.limits.maxParseMillis}ms wall-clock — worker hard-killed`,
            ),
          ),
        );
      }, input.limits.maxParseMillis + HARD_KILL_GRACE_MS);

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (error) =>
        settle(() => reject(new ParseLimitError(`Parse worker failed to start: ${error.message}`))),
      );
      child.on('close', (code) => {
        settle(() => {
          // the result is the last stdout line; anything above is stray output
          const lines = Buffer.concat(stdout).toString('utf8').trim().split('\n');
          const result = parseResult(lines[lines.length - 1] ?? '');
          if (result && result.ok) return resolve(result.drafts);
          if (result && !result.ok) {
            return reject(
              result.limit ? new ParseLimitError(result.error) : new Error(result.error),
            );
          }
          const hint = Buffer.concat(stderr).toString('utf8').slice(0, 300);
          reject(
            new ParseLimitError(
              `Parse worker died (exit ${code ?? 'signal'})${hint ? `: ${hint}` : ''}`,
            ),
          );
        });
      });

      // the input travels over stdin — no size limits on argv, no shell
      // quoting; isCancelled is a function and cannot cross the boundary
      child.stdin.write(
        JSON.stringify({
          adapterName: input.adapterName,
          content: input.content,
          profile: input.profile,
          limits: input.limits,
        }),
      );
      child.stdin.end();
    });
}

/**
 * In-process runner (test seam, and the path for injected custom adapters):
 * same contract, no process. Honours the cooperative budget and cancellation
 * but cannot hard-kill synchronous CPU-bound code — exactly the property the
 * worker adds.
 */
export function createInlineAdapterRunner(adapters: ReadonlyMap<string, Adapter>): AdapterRunner {
  return async (input) => {
    const adapter = adapters.get(input.adapterName);
    if (!adapter) throw new ParseLimitError(`Unknown import adapter: ${input.adapterName}`);
    const budget = startBudget(input.limits, Date.now, {
      jobId: input.adapterName,
      isCancelled: input.isCancelled ?? (() => false),
    });
    const ctx: AdapterContext = { budget, limits: input.limits, profile: input.profile };
    return adapter.parse(input.content, ctx);
  };
}
