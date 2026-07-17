import { useState } from 'react';
import { DEFAULT_ENGINE_CONFIG } from '@netplan/domain';
import { useAppStore } from '../state/store';
import { Toggle } from '../ui';

/**
 * SETTINGS destination (design §3.2B; improvements M11, #68): surfaces what
 * already exists as project-level configuration — no invented settings.
 * Egress opt-ins keep their dedicated panel (linked); the rule-engine config
 * shows the DEFAULT_ENGINE_CONFIG knobs in force; retention lands with M13.
 */
export function SettingsPanel() {
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const setView = useAppStore((s) => s.setView);
  const revealSecret = useAppStore((s) => s.revealSecret);
  const hotkeyCardEnabled = useAppStore((s) => s.hotkeyCardEnabled);
  const setHotkeyCardEnabled = useAppStore((s) => s.setHotkeyCardEnabled);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  if (!project || !graph) return null;

  const secrets = graph.secretMatches;

  return (
    <section className="settings-panel" data-testid="settings-panel">
      <h2 className="panel-title">Settings</h2>

      <h3 className="field-section__title">Project</h3>
      <p data-testid="settings-project">
        {project.name} · created {new Date(project.createdAt).toLocaleDateString()}
      </p>

      <h3 className="field-section__title">Interface</h3>
      <div className="settings-row" data-testid="settings-hotkey-card">
        <span>Show the shortcut card on the canvas</span>
        <Toggle
          checked={hotkeyCardEnabled}
          label="Show the shortcut card on the canvas"
          data-testid="settings-hotkey-card-toggle"
          onChange={setHotkeyCardEnabled}
        />
      </div>

      <h3 className="field-section__title">Egress &amp; threat intel</h3>
      <p className="panel-empty">
        Outbound calls pass one guarded chokepoint, off by default (ADR-0027).
      </p>
      <button type="button" data-testid="settings-open-egress" onClick={() => setView('egress')}>
        Open egress settings
      </button>

      <h3 className="field-section__title">Rule engine configuration</h3>
      <p className="panel-empty" data-testid="settings-rule-config">
        Config version {DEFAULT_ENGINE_CONFIG.version} ·{' '}
        {Object.keys(DEFAULT_ENGINE_CONFIG.rules).length === 0
          ? 'no per-rule overrides — every rule runs enabled at its declared severity (ADR-0024)'
          : `${Object.keys(DEFAULT_ENGINE_CONFIG.rules).length} per-rule override(s)`}
      </p>
      <table className="data-table settings-table" data-testid="settings-indicator-lists">
        <thead>
          <tr>
            <th>Indicator list (rule config data, ADR-0024)</th>
            <th>Entries</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(DEFAULT_ENGINE_CONFIG.lists).map(([list, entries]) => (
            <tr key={list}>
              <td>{list}</td>
              <td>{Array.isArray(entries) ? entries.length : 0}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="field-section__title">Detected secrets (§3.13)</h3>
      {secrets.length === 0 ? (
        <p className="panel-empty" data-testid="settings-secrets-empty">
          No secrets detected in imported evidence.
        </p>
      ) : (
        <table className="data-table settings-table" data-testid="settings-secrets">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {secrets.map((secret) => (
              <tr key={secret.id} data-testid={`secret-${secret.id}`}>
                <td>{secret.label}</td>
                <td className="settings-table__params">{revealed[secret.id] ?? secret.masked}</td>
                <td>
                  <button
                    type="button"
                    data-testid={`secret-reveal-${secret.id}`}
                    title="Reveal the original value — this is audited"
                    onClick={() => {
                      void revealSecret(secret.id).then((value) =>
                        setRevealed((prev) => ({ ...prev, [secret.id]: value })),
                      );
                    }}
                  >
                    Reveal (audited)
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="field-section__title">Evidence retention</h3>
      <p className="panel-empty" data-testid="settings-retention">
        Structured evidence is retained inline; oversized raw captures downgrade to hash-only. Raw
        evidence can be purged from the Imports view (kept as hash-only, audited); a secret whose
        source is purged can no longer be revealed.
      </p>
    </section>
  );
}
