import { useEffect, useRef, useState } from 'react';
import { buildCandidates, type Evidence, type ImportJob, type Observation } from '@netplan/domain';
import { getEvidenceBlob } from '../api/imports';
import { useAppStore } from '../state/store';
import { ConflictList } from './ConflictList';

const ADAPTERS = [
  { name: 'device-state', label: 'Device-state report (JSON)' },
  { name: 'nmap-xml', label: 'Nmap scan (XML)' },
  { name: 'tshark-flows', label: 'tshark flow summary (JSON/CSV)' },
];

function guessAdapter(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xml')) return 'nmap-xml';
  if (lower.endsWith('.csv')) return 'tshark-flows';
  return 'device-state';
}

/**
 * "Imports and Evidence" (design §3.2B/E, plan M7): the import wizard, the
 * job list with worker status, and the review screen where the operator
 * edits the pending ChangeSet before commit (ADR-0021).
 */
export function ImportsPanel() {
  const importJobs = useAppStore((s) => s.importJobs);
  const selected = useAppStore((s) => s.selectedImport);
  const notice = useAppStore((s) => s.importNotice);
  const refreshImports = useAppStore((s) => s.refreshImports);
  const uploadImport = useAppStore((s) => s.uploadImport);
  const selectImport = useAppStore((s) => s.selectImport);

  useEffect(() => {
    void refreshImports();
  }, [refreshImports]);

  return (
    <section className="imports-panel" data-testid="imports-panel">
      <div className="imports-panel__column imports-panel__jobs">
        <h2 className="panel-title">Imports and Evidence</h2>
        <ImportWizard onUpload={uploadImport} />
        {notice && (
          <p className="imports-panel__notice" data-testid="import-notice">
            ⚠ {notice}
          </p>
        )}
        <ul className="imports-panel__job-list" data-testid="import-job-list">
          {importJobs.length === 0 && <li className="panel-empty">No imports yet.</li>}
          {importJobs.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                className={`import-job${selected?.job.id === job.id ? ' import-job--selected' : ''}`}
                data-testid={`import-job-${job.parserName}-${job.status}`}
                onClick={() => void selectImport(job.id)}
              >
                <span className="import-job__parser">{job.parserName}</span>
                <span className={`import-job__status import-job__status--${job.status}`}>
                  {job.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="imports-panel__column imports-panel__review">
        {selected ? <ImportReview /> : <p className="panel-empty">Select an import job.</p>}
      </div>
    </section>
  );
}

function ImportWizard({
  onUpload,
}: {
  onUpload: (input: { filename: string; adapter: string; content: string }) => Promise<void>;
}) {
  const [adapter, setAdapter] = useState('device-state');
  // a filename-based guess only applies while the operator hasn't chosen
  const [adapterChosen, setAdapterChosen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const effectiveAdapter = adapterChosen ? adapter : guessAdapter(file.name);
    setAdapter(effectiveAdapter);
    setBusy(true);
    try {
      await onUpload({
        filename: file.name,
        adapter: effectiveAdapter,
        content: await file.text(),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-wizard" data-testid="import-wizard">
      <label>
        Source format
        <select
          data-testid="import-adapter-select"
          value={adapter}
          onChange={(e) => {
            setAdapter(e.target.value);
            setAdapterChosen(true);
          }}
        >
          {ADAPTERS.map((a) => (
            <option key={a.name} value={a.name}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-testid="import-upload-button"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
      >
        {busy ? 'Importing…' : '⇪ Import evidence file…'}
      </button>
      <input
        ref={fileInput}
        type="file"
        className="export-menu__file"
        data-testid="import-evidence-file-input"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function ImportReview() {
  const selected = useAppStore((s) => s.selectedImport);
  const commit = useAppStore((s) => s.commitSelectedImport);
  const rollback = useAppStore((s) => s.rollbackSelectedImport);
  if (!selected) return null;
  const { job, proposal, evidence, observations } = selected;

  const pendingConflicts = proposal?.conflicts.filter((c) => c.resolution === 'pending') ?? [];
  const creates = proposal?.operations.filter((o) => o.kind === 'CreateEntity') ?? [];
  const setFields = proposal?.operations.filter((o) => o.kind === 'SetField') ?? [];
  const byType = new Map<string, number>();
  for (const op of creates) {
    if (op.kind === 'CreateEntity') {
      byType.set(op.payload.entityType, (byType.get(op.payload.entityType) ?? 0) + 1);
    }
  }

  return (
    <div className="import-review" data-testid="import-review">
      <h3>
        {job.parserName} <span className={`import-job__status--${job.status}`}>{job.status}</span>
      </h3>
      {job.error && <p className="imports-panel__notice">⚠ {job.error}</p>}
      {job.status === 'review' && proposal && (
        <>
          <p data-testid="proposal-summary">
            Proposes{' '}
            {[...byType.entries()].map(([type, count]) => `${count} ${type}`).join(', ') ||
              'nothing'}
            {setFields.length > 0 ? ` and ${setFields.length} field change(s)` : ''}.
          </p>
          <ConflictList />
          <div className="import-review__actions">
            <button
              type="button"
              data-testid="import-commit-button"
              disabled={pendingConflicts.length > 0}
              title={
                pendingConflicts.length > 0
                  ? `${pendingConflicts.length} conflict(s) must be resolved first — the queue never auto-merges`
                  : 'Apply the reviewed ChangeSet to the project'
              }
              onClick={() => void commit()}
            >
              ✓ Commit import
            </button>
          </div>
        </>
      )}
      {job.status === 'committed' && (
        <div className="import-review__actions">
          <p>Committed as one ChangeSet — rollback inverts it atomically.</p>
          <button
            type="button"
            data-testid="import-rollback-button"
            onClick={() => void rollback()}
          >
            ⤺ Roll back import
          </button>
        </div>
      )}
      <ObservationSummary observations={observations} />
      <EvidenceViewer evidence={evidence} job={job} />
    </div>
  );
}

function ObservationSummary({ observations }: { observations: Observation[] }) {
  const candidates = buildCandidates(observations);
  const rows = [
    ...candidates.devices.map((c) => ({ key: c.key, kind: 'device', confidence: c.confidence })),
    ...candidates.identities.map((c) => ({
      key: c.key,
      kind: 'identity',
      confidence: c.confidence,
    })),
    ...candidates.flows.slice(0, 20).map((c) => ({
      key: c.key,
      kind: 'flow',
      confidence: c.confidence,
    })),
  ];
  if (rows.length === 0) return null;
  return (
    <details className="import-review__candidates" data-testid="import-candidates" open>
      <summary>Candidates ({rows.length})</summary>
      <table>
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Kind</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-testid={`candidate-${row.kind}`}>
              <td>{row.key}</td>
              <td>{row.kind}</td>
              <td data-testid="candidate-confidence">{Math.round(row.confidence * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function EvidenceViewer({ evidence, job }: { evidence: Evidence[]; job: ImportJob }) {
  const project = useAppStore((s) => s.project);
  const [content, setContent] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  async function view(record: Evidence) {
    if (!project) return;
    if (viewing === record.id) {
      setViewing(null);
      setContent(null);
      return;
    }
    try {
      const blob = await getEvidenceBlob(project.id, record.id);
      setViewing(record.id);
      setContent(blob.encoding === 'utf8' ? blob.content : '[binary content]');
    } catch (error) {
      setViewing(record.id);
      setContent(error instanceof Error ? error.message : 'No stored blob');
    }
  }

  return (
    <details className="evidence-viewer" data-testid="evidence-viewer" open>
      <summary>Evidence ({evidence.length})</summary>
      {evidence.map((record) => (
        <div key={record.id} className="evidence-viewer__record" data-testid="evidence-record">
          <div>
            <strong>{record.filename}</strong> · {record.sizeBytes} bytes ·{' '}
            {record.contentClass === 'binaryCapture' ? 'binary capture' : 'structured'} ·{' '}
            {record.retention === 'inline' ? 'stored inline' : 'hash only'}
          </div>
          <div className="evidence-viewer__hash" data-testid="evidence-hash">
            sha256 {record.sha256}
          </div>
          <div>
            parser {job.parserName} v{record.parserVersion}
            {record.chunkRef ? ` · chunk ${record.chunkRef}` : ''}
          </div>
          <button
            type="button"
            data-testid="evidence-view-button"
            onClick={() => void view(record)}
          >
            {viewing === record.id ? 'Hide content' : 'View content'}
          </button>
          {viewing === record.id && content !== null && (
            <pre className="evidence-viewer__content" data-testid="evidence-content">
              {content.length > 4000 ? `${content.slice(0, 4000)}…` : content}
            </pre>
          )}
        </div>
      ))}
    </details>
  );
}
