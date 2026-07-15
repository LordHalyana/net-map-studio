import type { FindingView } from './reconcile.js';

/**
 * Client-safe redaction for findings (design §3.12, Q15). When findings leave
 * the engineering team, the sensitive *specifics* — usernames, secret-like
 * hashes, external IPs and evidence paths — are masked, while the finding's
 * kind (title, category), severity, confidence, rule and verification steps stay
 * intact so the report is still actionable.
 */

export const FINDINGS_REDACTION_PROFILES = ['none', 'client-safe'] as const;
export type FindingsRedactionProfile = (typeof FINDINGS_REDACTION_PROFILES)[number];

export function isFindingsRedactionProfile(value: string): value is FindingsRedactionProfile {
  return FINDINGS_REDACTION_PROFILES.some((profile) => profile === value);
}

const SHA_LIKE = /\b[0-9a-f]{40,64}\b/gi;
const WINDOWS_PATH = /[a-zA-Z]:\\[^\s"']+/g;
const UNIX_PATH = /(?:\/[A-Za-z0-9._-]+){2,}/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/**
 * Mask sensitive specifics in free text. Paths first, so an IP inside a path is
 * not partially masked. IP masking is deliberately broad — a client-safe export
 * errs toward hiding an internal address rather than leaking an external one.
 */
export function maskSensitiveText(text: string, usernames: readonly string[] = []): string {
  let out = text
    .replace(SHA_LIKE, '[hash]')
    .replace(WINDOWS_PATH, '[path]')
    .replace(UNIX_PATH, '[path]')
    .replace(IPV6, '[ip]')
    .replace(IPV4, '[ip]');
  for (const name of usernames) {
    if (name.length < 2) continue;
    out = out.split(name).join('[user]');
  }
  return out;
}

/**
 * Apply the `client-safe` profile to a set of findings. `usernames` are the
 * modelled principal names to mask by exact match (pattern-based masking cannot
 * infer them). `none` returns the findings unchanged.
 */
export function redactFindings(
  findings: readonly FindingView[],
  profile: FindingsRedactionProfile,
  usernames: readonly string[] = [],
): FindingView[] {
  if (profile === 'none') return [...findings];
  return findings.map((view) => {
    if (!view.detection) return view;
    return {
      ...view,
      notes: maskSensitiveText(view.notes, usernames),
      detection: {
        ...view.detection,
        title: maskSensitiveText(view.detection.title, usernames),
        explanation: maskSensitiveText(view.detection.explanation, usernames),
      },
    };
  });
}
