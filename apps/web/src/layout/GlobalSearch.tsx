import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { ProjectState } from '@netplan/domain';
import { useAppStore, type Selection } from '../state/store';
import type { FindingsReport } from '../api/findings';

interface SearchHit {
  entityType: Selection['entityType'] | 'finding';
  id: string;
  label: string;
  detail: string;
  /** the canvas node to focus, when there is one */
  focusId: string | null;
}

function searchGraph(
  graph: ProjectState,
  findings: FindingsReport | null,
  query: string,
): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hit = (...values: (string | number | null)[]) =>
    values.some((v) => v != null && String(v).toLowerCase().includes(needle));
  const results: SearchHit[] = [];

  for (const device of graph.devices) {
    if (hit(device.name, device.vendor, device.model, ...device.tags)) {
      results.push({
        entityType: 'device',
        id: device.id,
        label: device.name,
        detail: `device · ${device.deviceType}`,
        focusId: device.id,
      });
    }
  }
  for (const address of graph.addresses) {
    if (hit(address.value)) {
      const iface = graph.interfaces.find((i) => i.id === address.interfaceId);
      const device = iface ? graph.devices.find((d) => d.id === iface.deviceId) : undefined;
      results.push({
        entityType: 'device',
        id: device?.id ?? address.id,
        label: address.value,
        detail: `${address.kind} · ${device?.name ?? '?'} ${iface?.name ?? ''}`,
        focusId: device?.id ?? null,
      });
    }
  }
  for (const network of graph.networks) {
    if (hit(network.name, network.cidr, network.vlanId)) {
      results.push({
        entityType: 'network',
        id: network.id,
        label: network.name,
        detail: `${network.kind}${network.vlanId != null ? ` · VLAN ${network.vlanId}` : ''}`,
        focusId: network.id,
      });
    }
  }
  for (const rule of graph.policyRules) {
    if (hit(rule.name, rule.justification, rule.owner)) {
      results.push({
        entityType: 'policyRule',
        id: rule.id,
        label: rule.name || `${rule.action} rule`,
        detail: `rule · ${rule.action}`,
        focusId: null,
      });
    }
  }
  // identities & findings (M3, #60; design §3.2A names both)
  for (const identity of graph.identities) {
    if (hit(identity.name, identity.domain)) {
      const host = identity.deviceId
        ? graph.devices.find((d) => d.id === identity.deviceId)
        : undefined;
      results.push({
        entityType: 'identity',
        id: identity.id,
        label: identity.scope === 'domain' ? `${identity.domain}\\${identity.name}` : identity.name,
        detail: `identity · ${identity.kind}${host ? ` on ${host.name}` : ''}`,
        focusId: identity.deviceId,
      });
    }
  }
  for (const finding of findings?.findings ?? []) {
    const title = finding.detection?.title;
    if (title && hit(title, finding.detection?.category ?? null)) {
      results.push({
        entityType: 'finding',
        id: finding.fingerprint,
        label: title,
        detail: `finding · ${finding.detection?.severity ?? 'info'}`,
        focusId: null,
      });
    }
  }
  return results.slice(0, 12);
}

export function GlobalSearch() {
  const graph = useAppStore((s) => s.graph);
  const findings = useAppStore((s) => s.findings);
  const refreshFindings = useAppStore((s) => s.refreshFindings);
  const select = useAppStore((s) => s.select);
  const focusRule = useAppStore((s) => s.focusRule);
  const focusFinding = useAppStore((s) => s.focusFinding);
  const [query, setQuery] = useState('');
  const results = useMemo(
    () => (graph ? searchGraph(graph, findings, query) : []),
    [graph, findings, query],
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // findings are analyzed on demand — fetch once so titles are searchable
  useEffect(() => {
    if (query.trim() && !findings) void refreshFindings();
  }, [query, findings, refreshFindings]);

  // Ctrl+F / `/` shortcut (M2, #59)
  useEffect(() => {
    function onFocusSearch() {
      inputRef.current?.focus();
    }
    window.addEventListener('netplan:focus-search', onFocusSearch);
    return () => window.removeEventListener('netplan:focus-search', onFocusSearch);
  }, []);

  function open(result: SearchHit) {
    if (result.entityType === 'policyRule') {
      // land on the focused rule row, not just the tab flip (M3, #60)
      focusRule(result.id);
    } else if (result.entityType === 'finding') {
      focusFinding(result.id);
    } else {
      select({ entityType: result.entityType, ids: [result.id] });
      if (result.focusId) {
        window.dispatchEvent(
          new CustomEvent('netplan:focus-node', { detail: { id: result.focusId } }),
        );
      }
    }
    setQuery('');
  }

  return (
    <div className="global-search">
      <Search size={13} className="global-search__icon" aria-hidden />
      <input
        ref={inputRef}
        value={query}
        placeholder="Search devices, IPs, VLANs, rules, identities, findings…"
        data-testid="global-search-input"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQuery('');
          const first = results[0];
          if (e.key === 'Enter' && first) open(first);
        }}
      />
      {results.length > 0 && (
        <ul className="global-search__results" data-testid="search-results">
          {results.map((result) => (
            <li key={`${result.entityType}-${result.id}-${result.label}`}>
              <button
                type="button"
                data-testid={`search-result-${result.label}`}
                onClick={() => open(result)}
              >
                <span className="global-search__label">{result.label}</span>
                <span className="global-search__detail">{result.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
