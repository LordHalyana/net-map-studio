import { useMemo, useState } from 'react';
import type { ProjectState } from '@netplan/domain';
import { useAppStore, type Selection } from '../state/store';

interface SearchHit {
  entityType: Selection['entityType'];
  id: string;
  label: string;
  detail: string;
  /** the canvas node to focus, when there is one */
  focusId: string | null;
}

function searchGraph(graph: ProjectState, query: string): SearchHit[] {
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
  return results.slice(0, 12);
}

export function GlobalSearch() {
  const graph = useAppStore((s) => s.graph);
  const select = useAppStore((s) => s.select);
  const setContextTab = useAppStore((s) => s.setContextTab);
  const [query, setQuery] = useState('');
  const results = useMemo(() => (graph ? searchGraph(graph, query) : []), [graph, query]);

  function open(result: SearchHit) {
    if (result.entityType === 'policyRule') {
      setContextTab('rules');
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
      <input
        value={query}
        placeholder="Search devices, IPs, VLANs, rules…"
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
