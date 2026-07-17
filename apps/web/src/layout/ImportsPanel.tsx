import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, TriangleAlert } from 'lucide-react';
import {
  buildCandidates,
  guessImportAdapter,
  IMPORT_FORMAT_SPECS,
  importSizeBlocker,
  preflightImport,
  wizardImportFormats,
  type Evidence,
  type ImportFormatSpec,
  type ImportJob,
  type Observation,
} from '@netplan/domain';
import {
  deviceStateJsonSchema,
  validateDeviceStateReport,
  type ValidationIssue,
} from '@netplan/import-contract';
import { cancelImport, getEvidenceBlob, resumeImport } from '../api/imports';
import { downloadBlob } from '../export/exports';
import { useAppStore } from '../state/store';
import { Button, IconButton, Spinner } from '../ui';
import { ConflictList } from './ConflictList';

// dropdown entries and extension guessing derive from the shared, round-trip
// tested format descriptors (#90 A0) — no adapter list lives in the UI
const ADAPTERS = wizardImportFormats();

/**
 * "Imports and Evidence" (design §3.2B/E, plan M7): the import wizard, the
 * job list with worker status, and the review screen where the operator
 * edits the pending ChangeSet before commit (ADR-0021).
 */
export function ImportsPanel() {
  const importJobs = useAppStore((s) => s.importJobs);
  const selected = useAppStore((s) => s.selectedImport);
  const refreshImports = useAppStore((s) => s.refreshImports);
  const uploadImport = useAppStore((s) => s.uploadImport);
  const selectImport = useAppStore((s) => s.selectImport);
  const project = useAppStore((s) => s.project);
  // first fetch in flight → loading row, never a misleading "No imports yet" (#90 B2)
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void refreshImports().finally(() => setLoaded(true));
  }, [refreshImports]);

  async function controlImport(action: 'cancel' | 'resume', jobId: string) {
    if (!project) return;
    await (action === 'cancel' ? cancelImport(project.id, jobId) : resumeImport(project.id, jobId));
    await refreshImports();
  }

  return (
    <section className="imports-panel" data-testid="imports-panel">
      <div className="imports-panel__column imports-panel__jobs">
        <h2 className="panel-title">Imports and Evidence</h2>
        <ImportWizard onUpload={uploadImport} />
        <ul className="imports-panel__job-list" data-testid="import-job-list">
          {importJobs.length === 0 &&
            (loaded ? (
              <li className="panel-empty">Import an evidence file to see jobs here.</li>
            ) : (
              <li className="panel-loading">
                <Spinner size="sm" label="Loading imports" /> Loading imports…
              </li>
            ))}
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
                  {job.progressStage ? ` · ${job.progressStage}` : ''}
                </span>
              </button>
              {job.status === 'pending' || job.status === 'parsing' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="import-cancel-button"
                  onClick={() => void controlImport('cancel', job.id)}
                >
                  cancel
                </Button>
              ) : job.status === 'cancelled' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="import-resume-button"
                  onClick={() => void controlImport('resume', job.id)}
                >
                  resume
                </Button>
              ) : null}
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
  // "Expected format" expansion is remembered per adapter (#90 A1)
  const [helpOpen, setHelpOpen] = useState<Record<string, boolean>>({});
  // device-state pre-upload validation result (#90 A2): issues block the
  // upload; a valid report shows its host count next to the upload button
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [validNote, setValidNote] = useState<string | null>(null);
  // advisory pre-flight blocker for the text formats (#90 A3)
  const [preflight, setPreflight] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const spec = IMPORT_FORMAT_SPECS[adapter];

  async function onFile(file: File | undefined) {
    if (!file) return;
    const effectiveAdapter = adapterChosen ? adapter : guessImportAdapter(file.name);
    setAdapter(effectiveAdapter);
    setIssues(null);
    setValidNote(null);
    setPreflight(null);

    // size gate on the file's TRUE byte count, before reading 64 MB into memory
    const oversize = importSizeBlocker(file.name, file.size);
    if (oversize) {
      setPreflight(oversize);
      return;
    }
    const content = await file.text();

    const effectiveSpec = IMPORT_FORMAT_SPECS[effectiveAdapter];
    if (effectiveSpec) {
      // cheap string gates shared with the server (#90 A3) — catches the
      // common failure modes instantly instead of via a failed job
      const blocker = preflightImport(effectiveSpec, file.name, content, file.size);
      if (blocker) {
        setPreflight(blocker);
        return;
      }
    }

    if (effectiveAdapter === 'device-state') {
      // full contract validation in-browser — the same diagnosis the CLI
      // prints, with zero server round-trip (#90 A2)
      let document: unknown;
      try {
        document = JSON.parse(content);
      } catch (error) {
        setIssues([
          {
            path: '(root)',
            message: `not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
          },
        ]);
        return;
      }
      const result = validateDeviceStateReport(document);
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setValidNote(
        `${result.hostCount} host${result.hostCount === 1 ? '' : 's'}, schema ${result.schemaVersion}`,
      );
    }

    setBusy(true);
    try {
      await onUpload({ filename: file.name, adapter: effectiveAdapter, content });
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
            <option key={a.adapter} value={a.adapter}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <div className="import-wizard__upload">
        <Button
          data-testid="import-upload-button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? (
            <>
              <Spinner size="sm" label="Importing" /> Importing…
            </>
          ) : (
            '⇪ Import evidence file…'
          )}
        </Button>
        {validNote && (
          <span className="import-wizard__valid" data-testid="import-validation-ok">
            <Check size={12} className="inline-icon" aria-hidden /> {validNote}
          </span>
        )}
      </div>
      {preflight && (
        <div className="import-validation" data-testid="import-preflight-error">
          <p className="imports-panel__notice">
            <TriangleAlert size={12} className="inline-icon" aria-hidden /> {preflight}
          </p>
        </div>
      )}
      {issues && (
        <div className="import-validation" data-testid="import-validation-errors">
          <p className="imports-panel__notice">
            <TriangleAlert size={12} className="inline-icon" aria-hidden /> Not a valid device-state
            report — upload blocked. Fix these first:
          </p>
          <ul className="import-validation__issues">
            {issues.slice(0, MAX_SHOWN_ISSUES).map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                <code>{issue.path}</code> — {issue.message}
              </li>
            ))}
          </ul>
          {issues.length > MAX_SHOWN_ISSUES && (
            <p className="import-validation__more">
              +{issues.length - MAX_SHOWN_ISSUES} more issue
              {issues.length - MAX_SHOWN_ISSUES === 1 ? '' : 's'} — the validator CLI prints the
              full list
            </p>
          )}
        </div>
      )}
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
      {spec && (
        <FormatHelp
          spec={spec}
          open={helpOpen[adapter] ?? false}
          onToggle={(open) => setHelpOpen((prev) => ({ ...prev, [adapter]: open }))}
        />
      )}
    </div>
  );
}

/** How many validation issues render inline before the "+n more" line (#90 A2). */
const MAX_SHOWN_ISSUES = 20;

/** `example.csv` for ".csv"-style suffixes; the bare suffix (`conn.log`) otherwise. */
function exampleFilename(spec: ImportFormatSpec): string {
  const suffix = spec.extensions[0] ?? '.txt';
  return suffix.startsWith('.') ? `example${suffix}` : suffix;
}

/**
 * The "Expected format" helper (#90 A1): everything it renders comes from the
 * adapter's ImportFormatSpec — summary, accepted-file chips, the field table,
 * a copyable/downloadable minimal example, and the sharp-edge notes.
 */
function FormatHelp({
  spec,
  open,
  onToggle,
}: {
  spec: ImportFormatSpec;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const pushToast = useAppStore((s) => s.pushToast);

  async function copyExample() {
    try {
      await navigator.clipboard.writeText(spec.example);
      pushToast('Example copied to clipboard', 'success');
    } catch {
      pushToast('Clipboard unavailable — use Download example instead');
    }
  }

  return (
    <details
      className="format-help"
      data-testid="import-format-help"
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
    >
      <summary>Expected format</summary>
      <div className="format-help__body">
        <p className="format-help__summary">{spec.summary}</p>
        <ul className="format-help__chips" aria-label="Accepted files">
          {[...spec.fileKinds, ...spec.extensions].map((chip) => (
            <li key={chip} className="format-help__chip">
              {chip}
            </li>
          ))}
        </ul>
        <div className="format-help__scroll">
          <table className="format-help__table" data-testid="import-format-fields">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Required</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {spec.fields.map((field) => (
                <tr key={field.name} data-testid="import-format-field">
                  <td className="format-help__field-name">{field.name}</td>
                  <td>{field.type}</td>
                  <td>
                    {field.required ? <span className="format-help__required">yes</span> : '—'}
                  </td>
                  <td>{field.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="format-help__example-bar">
          <span>Minimal example</span>
          <IconButton
            icon={Copy}
            label="Copy example"
            size="sm"
            data-testid="import-format-copy"
            onClick={() => void copyExample()}
          />
          <Button
            size="sm"
            data-testid="import-format-download"
            onClick={() =>
              downloadBlob(exampleFilename(spec), new Blob([spec.example], { type: 'text/plain' }))
            }
          >
            <Download size={12} className="inline-icon" aria-hidden /> Download example
          </Button>
          {spec.adapter === 'device-state' && (
            <Button
              size="sm"
              data-testid="import-format-schema-download"
              title="The machine-readable contract — wire it into your collection pipeline's CI"
              onClick={() =>
                downloadBlob(
                  'device-state.schema.json',
                  new Blob([`${JSON.stringify(deviceStateJsonSchema(), null, 2)}\n`], {
                    type: 'application/json',
                  }),
                )
              }
            >
              <Download size={12} className="inline-icon" aria-hidden /> JSON Schema
            </Button>
          )}
        </div>
        <pre className="format-example" data-testid="import-format-example">
          {spec.example}
        </pre>
        <ul className="format-help__notes">
          {spec.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </details>
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
      {job.error && (
        <p className="imports-panel__notice">
          <TriangleAlert size={12} className="inline-icon" aria-hidden /> {job.error}
        </p>
      )}
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
            <Button
              variant="primary"
              data-testid="import-commit-button"
              disabled={pendingConflicts.length > 0}
              title={
                pendingConflicts.length > 0
                  ? `${pendingConflicts.length} conflict(s) must be resolved first — the queue never auto-merges`
                  : 'Apply the reviewed ChangeSet to the project'
              }
              onClick={() => void commit()}
            >
              <Check size={12} className="inline-icon" aria-hidden /> Commit import
            </Button>
          </div>
        </>
      )}
      {job.status === 'committed' && (
        <div className="import-review__actions">
          <p>Committed as one ChangeSet — rollback inverts it atomically.</p>
          <Button
            variant="danger"
            data-testid="import-rollback-button"
            onClick={() => void rollback()}
          >
            ⤺ Roll back import
          </Button>
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
      <table className="data-table">
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
              <td className="data-table__num" data-testid="candidate-confidence">
                {Math.round(row.confidence * 100)}%
              </td>
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
          <Button
            size="sm"
            variant="ghost"
            data-testid="evidence-view-button"
            onClick={() => void view(record)}
          >
            {viewing === record.id ? 'Hide content' : 'View content'}
          </Button>
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
