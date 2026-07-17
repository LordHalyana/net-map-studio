import { useCallback, useEffect, useState } from 'react';
import {
  indicatorTypeSchema,
  localFeedEntrySchema,
  type EgressAuditRecord,
  type EgressSettings,
  type IndicatorType,
  type LocalFeedEntry,
} from '@netplan/domain';
import { z } from 'zod';
import {
  fetchEnrichment,
  getEgressSettings,
  getLocalFeed,
  listEgressAudit,
  listEnrichments,
  putEgressSettings,
  putLocalFeed,
  type EnrichmentView,
} from '../api/egress';
import { useAppStore } from '../state/store';
import { Button, Spinner, Toggle } from '../ui';

/**
 * The egress door & threat-intel workspace (P4-M7, ADR-0027/0028): per-project
 * door settings behind the disclosure, the operator-supplied local feed, the
 * enrichment lookup + stored enrichments (with staleness), and the audit trail
 * of every outbound call.
 */

/** The finalized disclosure copy (ADR-0027): what leaves, to whom, and the trail. */
const DISCLOSURE = [
  'When egress is enabled, the exact indicator values you look up (file hashes by default; IP addresses and domains only if you opt each type in below) are sent to the online threat-intelligence providers you use. Nothing else leaves this machine — never your captures, your topology, or your evidence.',
  'IP and domain lookups reveal who this network talks to; each requires its own opt-in.',
  'Every outbound call — including blocked attempts — is recorded in the audit trail below. The local feed never uses the network and works with egress off.',
].join(' ');

const INDICATOR_LABELS: Record<IndicatorType, string> = {
  fileHash: 'File hashes',
  ip: 'IP addresses',
  domain: 'Domains',
};

export function EgressPanel() {
  const project = useAppStore((s) => s.project);
  const [settings, setSettings] = useState<EgressSettings | null>(null);
  const [audit, setAudit] = useState<EgressAuditRecord[]>([]);
  const [enrichments, setEnrichments] = useState<EnrichmentView[]>([]);
  const [feedEntries, setFeedEntries] = useState<LocalFeedEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // first fetch in flight → loading rows, never misleading empty states (#90 B2)
  const [loaded, setLoaded] = useState(false);

  // settings form
  const [enabled, setEnabled] = useState(false);
  const [allowIp, setAllowIp] = useState(false);
  const [allowDomain, setAllowDomain] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // feed form
  const [feedIndicator, setFeedIndicator] = useState('');
  const [feedType, setFeedType] = useState<IndicatorType>('fileHash');
  const [feedVerdict, setFeedVerdict] = useState<'malicious' | 'suspicious' | 'benign'>(
    'malicious',
  );
  const feedVerdictSchema = z.enum(['malicious', 'suspicious', 'benign']);

  // lookup form
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupType, setLookupType] = useState<IndicatorType>('fileHash');
  const [lookupProvider, setLookupProvider] = useState('local-feed');

  const refresh = useCallback(async () => {
    if (!project) return;
    const [s, a, e, f] = await Promise.all([
      getEgressSettings(project.id),
      listEgressAudit(project.id),
      listEnrichments(project.id),
      getLocalFeed(project.id),
    ]);
    setSettings(s);
    setEnabled(s.enabled);
    setAllowIp(s.allowedIndicatorTypes.includes('ip'));
    setAllowDomain(s.allowedIndicatorTypes.includes('domain'));
    setAudit(a);
    setEnrichments(e);
    setFeedEntries(f.entries);
  }, [project]);

  useEffect(() => {
    refresh()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [refresh]);

  if (!project) return <p className="panel-empty">Open a project first.</p>;

  const run = (action: () => Promise<unknown>, successNotice?: string) => {
    setError(null);
    setNotice(null);
    void action()
      .then(async () => {
        if (successNotice) setNotice(successNotice);
        setAcknowledged(false);
        await refresh();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const saveSettings = () => {
    const allowedIndicatorTypes: IndicatorType[] = ['fileHash'];
    if (allowIp) allowedIndicatorTypes.push('ip');
    if (allowDomain) allowedIndicatorTypes.push('domain');
    run(
      () =>
        putEgressSettings(project.id, {
          enabled,
          allowedIndicatorTypes,
          acknowledgeDisclosure: acknowledged,
        }),
      'Egress settings saved.',
    );
  };

  const addFeedEntry = () => {
    const parsed = z
      .array(localFeedEntrySchema)
      .safeParse([
        { indicatorType: feedType, indicator: feedIndicator, verdict: feedVerdict, score: null },
      ]);
    if (!parsed.success) {
      setError('Feed entry is invalid — check the indicator value.');
      return;
    }
    run(() => putLocalFeed(project.id, [...feedEntries, ...parsed.data]), 'Local feed updated.');
    setFeedIndicator('');
  };

  const removeFeedEntry = (index: number) => {
    run(
      () =>
        putLocalFeed(
          project.id,
          feedEntries.filter((_, i) => i !== index),
        ),
      'Local feed updated.',
    );
  };

  const lookup = () => {
    run(
      () =>
        fetchEnrichment(project.id, {
          providerId: lookupProvider,
          indicatorType: lookupType,
          query: lookupQuery,
        }),
      'Enrichment stored as read-only Evidence.',
    );
  };

  const refetch = (view: EnrichmentView) => {
    run(
      () =>
        fetchEnrichment(project.id, {
          providerId: view.payload.providerId,
          indicatorType: view.payload.indicatorType,
          query: view.payload.query,
        }),
      'Re-fetched — a new Evidence artifact was stored.',
    );
  };

  return (
    <section className="egress-panel" data-testid="egress-panel">
      <h2 className="panel-title">Egress &amp; Threat Intel</h2>
      {error ? (
        <p className="egress-panel__error" data-testid="egress-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="egress-panel__notice" data-testid="egress-notice">
          {notice}
        </p>
      ) : null}

      <section className="egress-section" data-testid="egress-settings">
        <h3>Egress door</h3>
        <p className="egress-section__hint">
          Status:{' '}
          <strong data-testid="egress-status">
            {!loaded && !settings ? (
              <Spinner size="sm" label="Loading egress settings" />
            ) : settings?.enabled ? (
              'open (opt-in)'
            ) : (
              'shut — zero packets leave this machine'
            )}
          </strong>
        </p>
        <div className="egress-check">
          <Toggle
            className="switch--inline"
            data-testid="egress-enable"
            checked={enabled}
            onChange={setEnabled}
            label="Enable egress for this project"
          />
          Enable egress for this project
        </div>
        <div className="egress-check">
          <Toggle
            className="switch--inline"
            data-testid="egress-allow-ip"
            checked={allowIp}
            onChange={setAllowIp}
            label={`Allow ${INDICATOR_LABELS.ip} to leave`}
          />
          Allow {INDICATOR_LABELS.ip} to leave (per-type opt-in)
        </div>
        <div className="egress-check">
          <Toggle
            className="switch--inline"
            data-testid="egress-allow-domain"
            checked={allowDomain}
            onChange={setAllowDomain}
            label={`Allow ${INDICATOR_LABELS.domain} to leave`}
          />
          Allow {INDICATOR_LABELS.domain} to leave (per-type opt-in)
        </div>
        <p className="egress-disclosure" data-testid="egress-disclosure">
          {DISCLOSURE}
        </p>
        <div className="egress-check">
          <Toggle
            className="switch--inline"
            data-testid="egress-acknowledge"
            checked={acknowledged}
            onChange={setAcknowledged}
            label="I have read the disclosure"
          />
          I have read the disclosure and understand what leaves this machine.
        </div>
        <Button variant="primary" data-testid="egress-save" onClick={saveSettings}>
          Save egress settings
        </Button>
      </section>

      <section className="egress-section" data-testid="local-feed">
        <h3>Local threat-intel feed (zero egress)</h3>
        <div className="egress-form-row">
          <select
            data-testid="feed-type"
            value={feedType}
            onChange={(e) => setFeedType(indicatorTypeSchema.parse(e.target.value))}
          >
            <option value="fileHash">file hash</option>
            <option value="ip">ip</option>
            <option value="domain">domain</option>
          </select>
          <input
            data-testid="feed-indicator"
            placeholder="indicator value"
            value={feedIndicator}
            onChange={(e) => setFeedIndicator(e.target.value)}
          />
          <select
            data-testid="feed-verdict"
            value={feedVerdict}
            onChange={(e) => setFeedVerdict(feedVerdictSchema.parse(e.target.value))}
          >
            <option value="malicious">malicious</option>
            <option value="suspicious">suspicious</option>
            <option value="benign">benign</option>
          </select>
          <Button data-testid="feed-add" onClick={addFeedEntry}>
            Add
          </Button>
        </div>
        {feedEntries.length === 0 && !loaded ? (
          <p className="panel-loading">
            <Spinner size="sm" label="Loading local feed" /> Loading local feed…
          </p>
        ) : feedEntries.length === 0 ? (
          <p className="panel-empty">No indicators yet — the feed is operator-supplied.</p>
        ) : (
          <ul className="egress-list" data-testid="feed-entries">
            {feedEntries.map((entry, i) => (
              <li key={`${entry.indicatorType}:${entry.indicator}`}>
                <code>{entry.indicator}</code> ({entry.indicatorType}) — {entry.verdict}
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="feed-remove"
                  onClick={() => removeFeedEntry(i)}
                >
                  remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="egress-section" data-testid="enrichment-lookup">
        <h3>Enrichment lookup</h3>
        <div className="egress-form-row">
          <select
            data-testid="lookup-provider"
            value={lookupProvider}
            onChange={(e) => setLookupProvider(e.target.value)}
          >
            <option value="local-feed">local-feed (offline)</option>
            <option value="stub">stub (canned)</option>
          </select>
          <select
            data-testid="lookup-type"
            value={lookupType}
            onChange={(e) => setLookupType(indicatorTypeSchema.parse(e.target.value))}
          >
            <option value="fileHash">file hash</option>
            <option value="ip">ip</option>
            <option value="domain">domain</option>
          </select>
          <input
            data-testid="lookup-query"
            placeholder="indicator to look up"
            value={lookupQuery}
            onChange={(e) => setLookupQuery(e.target.value)}
          />
          <Button data-testid="lookup-run" onClick={lookup} disabled={!lookupQuery}>
            Look up
          </Button>
        </div>

        {enrichments.length === 0 && !loaded ? (
          <p className="panel-loading">
            <Spinner size="sm" label="Loading enrichments" /> Loading enrichments…
          </p>
        ) : enrichments.length === 0 ? (
          <p className="panel-empty">No stored enrichments.</p>
        ) : (
          <table className="egress-table" data-testid="enrichment-list">
            <thead>
              <tr>
                <th>Indicator</th>
                <th>Verdict</th>
                <th>Provider</th>
                <th>Fetched</th>
                <th>Freshness</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {enrichments.map((view) => (
                <tr key={view.evidenceId} data-testid="enrichment-row">
                  <td>
                    <code>{view.payload.query}</code>
                  </td>
                  <td>{view.payload.response.verdict}</td>
                  <td>{view.payload.providerId}</td>
                  <td>{view.payload.fetchedAt}</td>
                  <td>
                    {view.stale ? (
                      <span className="egress-stale" data-testid="enrichment-stale">
                        stale
                      </span>
                    ) : (
                      'fresh'
                    )}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="enrichment-refetch"
                      onClick={() => refetch(view)}
                    >
                      re-fetch
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="egress-section" data-testid="egress-audit">
        <h3>Egress audit trail</h3>
        {audit.length === 0 && !loaded ? (
          <p className="panel-loading">
            <Spinner size="sm" label="Loading audit trail" /> Loading audit trail…
          </p>
        ) : audit.length === 0 ? (
          <p className="panel-empty" data-testid="egress-audit-empty">
            No outbound calls have been made or attempted.
          </p>
        ) : (
          <table className="egress-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Provider</th>
                <th>Type</th>
                <th>Query</th>
                <th>Outcome</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((record) => (
                <tr key={record.id} data-testid="egress-audit-row">
                  <td>{record.timestamp}</td>
                  <td>{record.providerId}</td>
                  <td>{record.indicatorType}</td>
                  <td>
                    <code>{record.query}</code>
                  </td>
                  <td className={`egress-outcome--${record.outcome}`}>{record.outcome}</td>
                  <td>{record.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
