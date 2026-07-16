import { importProfileSchema, type ObservationDraft } from '@netplan/domain';
import { ParseLimitError } from '../guards.js';
import type { Adapter, AdapterContext } from './types.js';

/**
 * Netcat-text Adapter (design §3.6; improvements M12, #69): applies an
 * operator ImportProfile — a per-line regex whose named capture groups are
 * the field map (`host` required; `port`, `status`, `banner` optional) — to
 * free-form scan/banner logs. A matched open port becomes a low-confidence
 * Service claim per §3.7 ("a single Netcat text result: low unless
 * corroborated") — supplementalText, or bannerInference when a banner is
 * present. It emits Service observations only (a line needs a port); it never
 * asserts topology of its own, so a claim corroborates an existing Device
 * through the normal reconciliation pipeline rather than fabricating one.
 */

/** Lines longer than this are skipped — a defence against pathological input. */
const MAX_LINE_LENGTH = 4096;
/** Budget checkpoint cadence. */
const LINES_PER_CHECK = 200;

function looksOpen(status: string | undefined): boolean {
  if (status === undefined) return true; // profile without a status group: every match counts
  return /open|succeeded|connected/i.test(status);
}

export const netcatTextAdapter: Adapter = {
  name: 'netcat-text',
  version: '1.0.0',
  schemaVersion: '1',
  parse(content: string, ctx: AdapterContext): ObservationDraft[] {
    const parsed = importProfileSchema.safeParse(ctx.profile);
    if (!parsed.success) {
      throw new ParseLimitError(
        'netcat-text needs an ImportProfile (regex with a named `host` group) — pass profileId on the import',
      );
    }
    const profile = parsed.data;
    const drafts: ObservationDraft[] = [];
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      if (index % LINES_PER_CHECK === 0) ctx.budget.check();
      const line = lines[index] ?? '';
      if (line.length === 0 || line.length > MAX_LINE_LENGTH) continue;
      // a fresh regex per line: no lastIndex leakage, and the wall-clock cap
      // in the worker bounds catastrophic backtracking
      const match = new RegExp(profile.pattern).exec(line);
      const groups = match?.groups;
      if (!groups || !groups['host']) continue;

      const host = groups['host'];
      const port = groups['port'] !== undefined ? Number.parseInt(groups['port'], 10) : null;
      const banner = groups['banner']?.trim() ?? '';
      if (!looksOpen(groups['status'])) continue;
      if (port === null || !Number.isInteger(port) || port < 0 || port > 65535) continue;

      drafts.push({
        // §3.7: banner text lifts a probe slightly; a bare reachability line stays lowest
        contributor: banner ? 'bannerInference' : 'supplementalText',
        observedAt: null,
        claim: {
          targetKind: 'service',
          device: { ip: host },
          protocol: 'tcp',
          port,
          fields: {
            name: `tcp/${port}`,
            ...(banner ? { description: banner } : {}),
          },
        },
      });
    }
    return drafts;
  },
};
