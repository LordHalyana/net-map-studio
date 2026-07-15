import type { Endpoint, ProjectState } from '@netplan/domain';

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function endpointName(state: ProjectState, endpoint: Endpoint): string {
  switch (endpoint.kind) {
    case 'interface':
      return state.interfaces.find((i) => i.id === endpoint.id)?.name ?? endpoint.id;
    case 'device':
      return state.devices.find((d) => d.id === endpoint.id)?.name ?? endpoint.id;
    case 'network':
    case 'subnet':
      return state.networks.find((n) => n.id === endpoint.id)?.name ?? endpoint.id;
    case 'zone':
      return state.zones.find((z) => z.id === endpoint.id)?.name ?? endpoint.id;
  }
}

function interfaceLabel(state: ProjectState, interfaceId: string): string {
  const iface = state.interfaces.find((i) => i.id === interfaceId);
  const device = iface ? state.devices.find((d) => d.id === iface.deviceId) : undefined;
  return `${device?.name ?? '?'} · ${iface?.name ?? '?'}`;
}

/** A basic HTML design report (design §3.12). */
export function buildHtmlReport(state: ProjectState, generatedAt: string): string {
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
          interfaceLabel(state, l.source.id),
        )}</td><td>${esc(interfaceLabel(state, l.target.id))}</td></tr>`,
    )
    .join('\n');

  const ruleRows = state.policyRules
    .map((r) => {
      const service = r.serviceId ? state.services.find((s) => s.id === r.serviceId) : undefined;
      return `<tr><td>${esc(r.action)}</td><td>${esc(endpointName(state, r.source))}</td><td>${esc(
        endpointName(state, r.destination),
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

<h2>Policy rules (${state.policyRules.length})</h2>
<table><thead><tr><th>Action</th><th>Source</th><th>Destination</th><th>Service</th><th>Direction</th><th>Logging</th><th>Justification</th></tr></thead>
<tbody>${ruleRows}</tbody></table>
</body>
</html>`;
}
