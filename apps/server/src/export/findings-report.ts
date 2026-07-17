import {
  endpointResolver,
  type FindingView,
  type PolicyEndpoint,
  type ProjectState,
  type Severity,
} from '@netplan/domain';

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export interface FindingsReportMeta {
  opSeq: number;
  configHash: string;
}

function affectedLabel(state: ProjectState, affected: PolicyEndpoint | null): string {
  return affected ? endpointResolver(state).label(affected) : 'Network-wide';
}

/**
 * The dedicated Security Findings report (design §3.12, plan M12). Grouped by
 * severity; each finding shows its Severity, Confidence, evidence chain, rule +
 * version and verification steps — reproducible against the stamped rule/config
 * versions. Findings are advisory: network-wide findings say the network *may
 * be* compromised, never a confirmed verdict.
 */
export function buildFindingsReport(
  state: ProjectState,
  findings: readonly FindingView[],
  generatedAt: string,
  meta: FindingsReportMeta,
): string {
  const active = findings.filter((f) => f.detection !== null);
  const stale = findings.filter((f) => f.detection === null);

  const groups = SEVERITY_ORDER.map((severity) => {
    const inGroup = active.filter((f) => f.detection?.severity === severity);
    if (inGroup.length === 0) return '';
    const cards = inGroup.map((f) => findingCard(state, f)).join('\n');
    return `<section class="group"><h2 class="sev sev--${severity}">${severity} (${inGroup.length})</h2>${cards}</section>`;
  }).join('\n');

  const staleBlock =
    stale.length > 0
      ? `<section class="group"><h2>Retained (evidence gone) — ${stale.length}</h2>${stale
          .map(
            (f) =>
              `<div class="card"><p>Fingerprint ${esc(f.fingerprint)} — disposition <strong>${esc(f.status)}</strong>, retained after its evidence disappeared.</p></div>`,
          )
          .join('\n')}</section>`
      : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>Security Findings — ${esc(state.project.name)}</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0f1115; color:#d7dde8; font:14px/1.5 system-ui,sans-serif; margin:0; padding:32px; }
  h1 { color:#4da3ff; margin:0 0 4px; }
  .meta { color:#8b94a7; font-size:12px; margin-bottom:20px; }
  .disclaimer { border-left:3px solid #e5b455; padding:8px 12px; background:#1d2330; color:#e5b455; margin-bottom:24px; }
  .group { margin-bottom:28px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:#8b94a7; }
  .sev--critical { color:#ff9c9c; } .sev--high { color:#ffb27a; } .sev--medium { color:#e5b455; }
  .card { background:#161a22; border:1px solid #262c38; border-radius:8px; padding:12px 14px; margin:8px 0; }
  .card h3 { margin:0 0 6px; font-size:15px; }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:2px 12px; font-size:12px; margin:6px 0; }
  .kv dt { color:#8b94a7; }
  .expl { font-size:13px; margin:6px 0; }
  ol { margin:4px 0 0 18px; padding:0; font-size:12px; }
</style></head><body>
<h1>Security Findings</h1>
<div class="meta">${esc(state.project.name)} · generated ${esc(generatedAt)} · computed as of op #${meta.opSeq} · rules/config ${esc(meta.configHash.slice(0, 12))}</div>
<div class="disclaimer">These are advisory, evidence-backed findings — not confirmed-compromise verdicts. Severity is how serious an issue is if true; Confidence is how certain the evidence is. The two are independent.</div>
${groups || '<p>No active findings.</p>'}
${staleBlock}
</body></html>`;
}

function findingCard(state: ProjectState, f: FindingView): string {
  const d = f.detection;
  if (!d) return '';
  const evidence =
    d.evidenceRefs.length > 0
      ? `${d.evidenceRefs.length} evidence reference(s)`
      : `${d.contributingProvenanceRows.length} provenance row(s)`;
  const steps = d.verificationSteps.map((s) => `<li>${esc(s)}</li>`).join('');
  return `<div class="card">
  <h3>${esc(d.title)}</h3>
  <dl class="kv">
    <dt>Category</dt><dd>${esc(d.category)}</dd>
    <dt>Severity</dt><dd>${esc(d.severity)}</dd>
    <dt>Confidence</dt><dd>${(d.confidence * 100).toFixed(0)}%</dd>
    <dt>Affected</dt><dd>${esc(affectedLabel(state, d.affected))}</dd>
    <dt>Disposition</dt><dd>${esc(f.status)}</dd>
    <dt>Rule</dt><dd>${esc(d.ruleId)} v${esc(d.ruleVersion)} · config ${esc(d.configHash.slice(0, 8))}</dd>
    <dt>Evidence</dt><dd>${esc(evidence)}</dd>
  </dl>
  <p class="expl">${esc(d.explanation)}</p>
  ${steps ? `<strong>Verification steps</strong><ol>${steps}</ol>` : ''}
</div>`;
}

/** Flatten findings to CSV rows (design §3.12): the `findings` CSV export type. */
export function findingsToCsvRows(
  state: ProjectState,
  findings: readonly FindingView[],
): Record<string, unknown>[] {
  return findings.map((f) => ({
    fingerprint: f.fingerprint,
    status: f.status,
    stale: f.stale,
    category: f.detection?.category ?? '',
    severity: f.detection?.severity ?? '',
    confidence: f.detection ? f.detection.confidence.toFixed(3) : '',
    affected: f.detection ? affectedLabel(state, f.detection.affected) : '',
    ruleId: f.detection?.ruleId ?? '',
    ruleVersion: f.detection?.ruleVersion ?? '',
    title: f.detection?.title ?? '',
    explanation: f.detection?.explanation ?? '',
    verificationSteps: f.detection?.verificationSteps.join(' | ') ?? '',
  }));
}
