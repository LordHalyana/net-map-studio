import {
  endpointResolver,
  type FindingView,
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

export interface HtmlReportExtras {
  /** Findings (already redaction-filtered by the caller) for the summary section. */
  findings?: readonly FindingView[];
  redactionProfile?: string;
}

/** The HTML design report (design §3.12; depth per improvements M11, #68). */
export function buildHtmlReport(
  state: ProjectState,
  generatedAt: string,
  extras: HtmlReportExtras = {},
): string {
  const endpoints = endpointResolver(state);
  const deviceRows = state.devices
    .map((d) => {
      const zone = state.zones.find((z) => z.id === d.zoneId);
      const ifaces = state.interfaces.filter((i) => i.deviceId === d.id);
      return `<tr><td>${esc(d.name)}</td><td>${esc(d.deviceType)}</td><td>${esc(d.vendor)}</td><td>${esc(
        d.model,
      )}</td><td>${esc(zone?.name ?? '—')}</td><td>${esc(d.criticality)}</td><td>${ifaces.length}</td><td>${esc(
        d.lifecycleState,
      )}</td></tr>`;
    })
    .join('\n');

  const networkRows = state.networks
    .map((n) => {
      const members = state.interfaces.filter((i) => i.networkId === n.id).length;
      return `<tr><td>${esc(n.name)}</td><td>${esc(n.kind)}</td><td>${n.vlanId ?? '—'}</td><td>${esc(
        n.cidr || '—',
      )}</td><td>${members}</td></tr>`;
    })
    .join('\n');

  const linkRows = state.links
    .map(
      (l) =>
        `<tr><td>${esc(l.label || '—')}</td><td>${esc(l.kind)}</td><td>${esc(
          endpoints.label(l.source),
        )}</td><td>${esc(endpoints.label(l.target))}</td></tr>`,
    )
    .join('\n');

  const serviceRows = state.services
    .map((s) => {
      const device = s.deviceId ? state.devices.find((d) => d.id === s.deviceId) : undefined;
      const port =
        s.portStart != null
          ? s.portEnd != null && s.portEnd !== s.portStart
            ? `${s.portStart}–${s.portEnd}`
            : `${s.portStart}`
          : '—';
      return `<tr><td>${esc(s.name)}</td><td>${esc(s.protocol)}</td><td>${esc(port)}</td><td>${esc(
        s.process || '—',
      )}</td><td>${esc(device?.name ?? '—')}</td></tr>`;
    })
    .join('\n');

  const identityRows = state.identities
    .map((i) => {
      const host = i.deviceId ? state.devices.find((d) => d.id === i.deviceId) : undefined;
      const assignments = state.roleAssignments.filter((r) => r.identityId === i.id).length;
      return `<tr><td>${esc(i.scope === 'domain' ? `${i.domain}\\${i.name}` : i.name)}</td><td>${esc(
        i.scope,
      )}</td><td>${esc(i.kind)}</td><td>${esc(host?.name ?? '—')}</td><td>${assignments}</td></tr>`;
    })
    .join('\n');

  const findings = extras.findings ?? [];
  const findingsBySeverity = new Map<Severity, number>();
  for (const finding of findings) {
    if (finding.status !== 'new' || finding.stale) continue;
    const severity = finding.detection?.severity ?? 'info';
    findingsBySeverity.set(severity, (findingsBySeverity.get(severity) ?? 0) + 1);
  }
  const findingRows = findings
    .filter((f) => f.status === 'new' && !f.stale && f.detection)
    .map(
      (f) =>
        `<tr><td>${esc(f.detection?.severity ?? 'info')}</td><td>${esc(
          f.detection?.title ?? '',
        )}</td><td>${esc(f.detection?.category ?? '')}</td></tr>`,
    )
    .join('\n');

  const ruleRows = state.policyRules
    .map((r) => {
      const service = r.serviceId ? state.services.find((s) => s.id === r.serviceId) : undefined;
      return `<tr><td>${esc(r.action)}</td><td>${esc(endpoints.label(r.source))}</td><td>${esc(
        endpoints.label(r.destination),
      )}</td><td>${esc(service ? service.name : 'any')}</td><td>${esc(r.direction)}</td><td>${
        r.logging ? 'yes' : 'no'
      }</td><td>${esc(r.justification || '—')}</td></tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(state.project.name)} — NetPlan Studio design report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a2233; }
  h1 { margin-bottom: 0; }
  .meta { color: #667; margin-bottom: 2rem; }
  table { border-collapse: collapse; margin: 0.5rem 0 2rem; width: 100%; }
  th, td { border: 1px solid #ccd; padding: 4px 10px; text-align: left; font-size: 14px; }
  th { background: #eef1f7; }
</style>
</head>
<body>
<h1>${esc(state.project.name)}</h1>
<p class="meta">NetPlan Studio design report · generated ${esc(generatedAt)} · ${
    state.devices.length
  } devices · ${state.networks.length} networks · ${state.links.length} links · ${
    state.policyRules.length
  } rules</p>

<h2>Devices (${state.devices.length})</h2>
<table><thead><tr><th>Name</th><th>Type</th><th>Vendor</th><th>Model</th><th>Zone</th><th>Criticality</th><th>Interfaces</th><th>Lifecycle</th></tr></thead>
<tbody>${deviceRows}</tbody></table>

<h2>Networks (${state.networks.length})</h2>
<table><thead><tr><th>Name</th><th>Kind</th><th>VLAN</th><th>CIDR</th><th>Members</th></tr></thead>
<tbody>${networkRows}</tbody></table>

<h2>Links (${state.links.length})</h2>
<table><thead><tr><th>Label</th><th>Kind</th><th>Source</th><th>Target</th></tr></thead>
<tbody>${linkRows}</tbody></table>

<h2>Services (${state.services.length})</h2>
<table><thead><tr><th>Name</th><th>Protocol</th><th>Port</th><th>Process</th><th>Device</th></tr></thead>
<tbody>${serviceRows}</tbody></table>

<h2>Policy rules (${state.policyRules.length})</h2>
<table><thead><tr><th>Action</th><th>Source</th><th>Destination</th><th>Service</th><th>Direction</th><th>Logging</th><th>Justification</th></tr></thead>
<tbody>${ruleRows}</tbody></table>

<h2>Identities (${state.identities.length})</h2>
<table><thead><tr><th>Name</th><th>Scope</th><th>Kind</th><th>Host</th><th>Role assignments</th></tr></thead>
<tbody>${identityRows}</tbody></table>

<h2>Open findings (${findingRows ? findings.filter((f) => f.status === 'new' && !f.stale).length : 0})${
    extras.redactionProfile ? ` — redacted (${esc(extras.redactionProfile)})` : ''
  }</h2>
<p class="meta">${[...findingsBySeverity.entries()].map(([sev, n]) => `${esc(sev)}: ${n}`).join(' · ') || 'none'}</p>
<table><thead><tr><th>Severity</th><th>Title</th><th>Category</th></tr></thead>
<tbody>${findingRows}</tbody></table>
</body>
</html>`;
}
