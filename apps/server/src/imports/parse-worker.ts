import { z } from 'zod';
import { parseLimitsSchema } from './guards.js';
import { builtInAdapters } from './adapters/registry.js';
import { ParseLimitError, startBudget } from './guards.js';
import type { AdapterRunResult } from './worker-runner.js';

const adapterRunInputSchema = z.object({
  adapterName: z.string(),
  content: z.string(),
  profile: z.unknown().optional(),
  limits: parseLimitsSchema,
});

/**
 * The parse worker (§3.5; improvements M12, #69): a standalone process that
 * reads one AdapterRunInput from stdin, executes the adapter, and prints one
 * AdapterRunResult as the final stdout line. Anything that goes wrong —
 * schema violations, budget trips, OOM, a crash — ends this process; the
 * parent enforces the wall clock and heap cap from outside, so the main
 * application never blocks and never dies with the parse.
 */

function emit(result: AdapterRunResult): void {
  process.stdout.write(`\n${JSON.stringify(result)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function run(): Promise<void> {
  try {
    const input = adapterRunInputSchema.parse(JSON.parse(await readStdin()));
    const adapter = builtInAdapters.get(input.adapterName);
    if (!adapter) throw new ParseLimitError(`Unknown import adapter: ${input.adapterName}`);
    const budget = startBudget(input.limits);
    const drafts = await adapter.parse(input.content, {
      budget,
      limits: input.limits,
      profile: input.profile,
    });
    emit({ ok: true, drafts });
  } catch (error) {
    emit({
      ok: false,
      error: error instanceof Error ? error.message : 'Parse failed',
      limit: error instanceof ParseLimitError,
    });
    process.exitCode = 1;
  }
}

void run();
