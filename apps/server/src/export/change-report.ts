import type {
  ChangeSetRecord,
  OperationLogEntry,
  ProjectState,
  SettableEntityType,
} from '@netplan/domain';

/**
 * AS-IS → TO-BE change report (design §3.12; improvements M11, #68): renders
 * the existing diff machinery as a client deliverable. Additions are
 * `planned` objects, removals are `removedInProposal`, and field-deltas come
 * from SetField Operations inside registered proposal ChangeSets (ADR-0026)
 * — the same material the Diff canvas mode and DiffPanel read.
 */

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

interface NamedEntity {
  id: string;
  name?: string;
  label?: string;
}

function collectByLifecycle(
  state: ProjectState,
  lifecycleState: 'planned' | 'removedInProposal',
): { entityType: string; label: string }[] {
  const out: { entityType: string; label: string }[] = [];
  const scan = (
    entityType: string,
    items: readonly (NamedEntity & { lifecycleState: string })[],
  ) => {
    for (const item of items) {
      if (item.lifecycleState === lifecycleState) {
        out.push({ entityType, label: item.name ?? item.label ?? item.id });
      }
    }
  };
  scan('device', state.devices);
  scan('network', state.networks);
  scan('site', state.sites);
  scan('zone', state.zones);
  scan('link', state.links);
  scan('policyRule', state.policyRules);
  scan('service', state.services);
  return out;
}

function entityLabel(state: ProjectState, entityType: SettableEntityType, id: string): string {
  const pools: Partial<Record<SettableEntityType, readonly NamedEntity[]>> = {
    device: state.devices,
    network: state.networks,
    site: state.sites,
    zone: state.zones,
    service: state.services,
    policyRule: state.policyRules,
  };
  const hit = pools[entityType]?.find((e) => e.id === id);
  return hit?.name ?? hit?.label ?? id.slice(0, 8);
}

export function buildChangeReport(
  state: ProjectState,
  changeSets: readonly ChangeSetRecord[],
  log: readonly OperationLogEntry[],
  generatedAt: string,
): string {
  const additions = collectByLifecycle(state, 'planned');
  const removals = collectByLifecycle(state, 'removedInProposal');

  // field-deltas: SetField ops belonging to registered proposal ChangeSets
  const proposalIds = new Map<string, ChangeSetRecord>(
    changeSets.filter((c) => c.reviewStatus !== null).map((c) => [c.id, c]),
  );
  const deltas: { changeSet: string; entity: string; field: string; from: string; to: string }[] =
    [];
  for (const entry of log) {
    if (entry.role !== 'do' || !entry.changeSetId) continue;
    const proposal = proposalIds.get(entry.changeSetId);
    if (!proposal || entry.payload.kind !== 'SetField') continue;
    deltas.push({
      changeSet: proposal.label,
      entity: entityLabel(state, entry.payload.entityType, entry.payload.entityId),
      field: entry.payload.field,
      from: JSON.stringify(entry.payload.previousValue),
      to: JSON.stringify(entry.payload.value),
    });
  }

  const list = (rows: { entityType: string; label: string }[]) =>
    rows.map((r) => `<tr><td>${esc(r.entityType)}</td><td>${esc(r.label)}</td></tr>`).join('\n');

  const deltaRows = deltas
    .map(
      (d) =>
        `<tr><td>${esc(d.changeSet)}</td><td>${esc(d.entity)}</td><td>${esc(d.field)}</td><td>${esc(
          d.from,
        )}</td><td>${esc(d.to)}</td></tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(state.project.name)} — NetPlan Studio change report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a2233; }
  h1 { margin-bottom: 0; }
  .meta { color: #667; margin-bottom: 2rem; }
  table { border-collapse: collapse; margin: 0.5rem 0 2rem; width: 100%; }
  th, td { border: 1px solid #ccd; padding: 4px 10px; text-align: left; font-size: 14px; }
  th { background: #eef1f7; }
  .add th { background: #e7f6ec; }
  .remove th { background: #fbecec; }
</style>
</head>
<body>
<h1>${esc(state.project.name)} — AS-IS → TO-BE</h1>
<p class="meta">NetPlan Studio change report · generated ${esc(generatedAt)} · ${additions.length} additions · ${removals.length} removals · ${deltas.length} field changes</p>

<h2>Additions (planned)</h2>
<table class="add"><thead><tr><th>Type</th><th>Object</th></tr></thead>
<tbody>${list(additions) || '<tr><td colspan="2">none</td></tr>'}</tbody></table>

<h2>Removals (removed in proposal)</h2>
<table class="remove"><thead><tr><th>Type</th><th>Object</th></tr></thead>
<tbody>${list(removals) || '<tr><td colspan="2">none</td></tr>'}</tbody></table>

<h2>Field changes (proposal ChangeSets)</h2>
<table><thead><tr><th>Proposal</th><th>Object</th><th>Field</th><th>From</th><th>To</th></tr></thead>
<tbody>${deltaRows || '<tr><td colspan="5">none</td></tr>'}</tbody></table>
</body>
</html>`;
}
