import { z } from 'zod';

/**
 * Secrets & credential masking (design §3.13; improvements M13, #70). A
 * detection pass over ingested text (evidence, observation values) finds
 * private keys, `password=` patterns, connection strings and high-entropy
 * tokens. Matched values are stored masked-by-default with an explicit,
 * audited per-value reveal, and excluded from default report/export output.
 *
 * The pattern list is Rule-config-style data (ADR-0024) — operator-extendable,
 * never code. Kept pure so both the import pipeline and the export redactor
 * can call it deterministically.
 */

export const secretKindSchema = z.enum([
  'privateKey',
  'passwordAssignment',
  'connectionString',
  'highEntropyToken',
  'custom',
]);
export type SecretKind = z.infer<typeof secretKindSchema>;

export interface SecretPattern {
  kind: SecretKind;
  /** Global regex; the whole match (or capture group 1, when present) is masked. */
  regex: RegExp;
  label: string;
}

/** Built-in detectors (§3.13). Sources are literal so they recompile per call. */
const BUILT_IN_SOURCES: { kind: SecretKind; label: string; source: string; flags: string }[] = [
  {
    kind: 'privateKey',
    label: 'PEM private key',
    source: '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----',
    flags: 'g',
  },
  {
    kind: 'passwordAssignment',
    label: 'password assignment',
    source: '(?:password|passwd|pwd|secret|api[_-]?key|token)\\s*[=:]\\s*(\\S{4,})',
    flags: 'gi',
  },
  {
    kind: 'connectionString',
    label: 'connection string with credentials',
    source: '[a-z][a-z0-9+.-]*://[^\\s:@/]+:([^\\s@/]+)@',
    flags: 'gi',
  },
  {
    kind: 'highEntropyToken',
    label: 'high-entropy token',
    // long base64/hex-ish runs — the entropy gate below filters false positives
    source: '\\b([A-Za-z0-9+/_-]{32,})\\b',
    flags: 'g',
  },
];

/** Operator-tunable config (Rule-config-style data, ADR-0024). */
export const secretsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Extra operator regexes (source strings), matched as `custom`. */
  extraPatterns: z.array(z.string()).default([]),
  /** Shannon-entropy floor (bits/char) for the high-entropy detector. */
  minTokenEntropy: z.number().default(3.5),
});
export type SecretsConfig = z.infer<typeof secretsConfigSchema>;

export const DEFAULT_SECRETS_CONFIG: SecretsConfig = secretsConfigSchema.parse({});

function shannonEntropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function patterns(config: SecretsConfig): SecretPattern[] {
  const built = BUILT_IN_SOURCES.map((p) => ({
    kind: p.kind,
    label: p.label,
    regex: new RegExp(p.source, p.flags),
  }));
  const extra = config.extraPatterns.map((source) => ({
    kind: 'custom' as const,
    label: 'operator pattern',
    regex: new RegExp(source, 'g'),
  }));
  return [...built, ...extra];
}

export interface DetectedSecret {
  kind: SecretKind;
  label: string;
  /** The raw matched value — masked before it ever leaves the server. */
  value: string;
  /** Character offset of the value in the source text. */
  index: number;
}

/** The masked stand-in for a secret value, preserving a hint of its shape. */
export function maskValue(value: string): string {
  const head = value.slice(0, 2);
  return `${head}${'•'.repeat(Math.min(8, Math.max(4, value.length - 2)))}[redacted]`;
}

/** Detect every secret occurrence in `text`. Pure and deterministic. */
export function detectSecrets(
  text: string,
  config: SecretsConfig = DEFAULT_SECRETS_CONFIG,
): DetectedSecret[] {
  if (!config.enabled || !text) return [];
  const matches: DetectedSecret[] = [];
  for (const pattern of patterns(config)) {
    pattern.regex.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = pattern.regex.exec(text)) !== null) {
      // capture group 1 is the sensitive slice when the pattern brackets it
      const value = hit[1] ?? hit[0];
      const index = hit[1] !== undefined ? hit.index + hit[0].indexOf(hit[1]) : hit.index;
      if (pattern.kind === 'highEntropyToken' && shannonEntropy(value) < config.minTokenEntropy) {
        continue;
      }
      matches.push({ kind: pattern.kind, label: pattern.label, value, index });
      if (hit.index === pattern.regex.lastIndex) pattern.regex.lastIndex++;
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

/** Replace every detected secret value in `text` with its mask. */
export function maskSecrets(text: string, config: SecretsConfig = DEFAULT_SECRETS_CONFIG): string {
  const found = detectSecrets(text, config);
  if (found.length === 0) return text;
  // unique values, longest first, so a value that contains another masks cleanly
  const values = [...new Set(found.map((m) => m.value))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const value of values) out = out.split(value).join(maskValue(value));
  return out;
}
