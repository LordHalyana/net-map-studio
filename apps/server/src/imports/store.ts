import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  applyResolution,
  buildCandidates,
  buildProposal,
  changeSetIdSchema,
  evidenceIdSchema,
  evidenceSchema,
  generateProvenanceRows,
  importJobIdSchema,
  importJobSchema,
  importProposalSchema,
  importResolutionActionSchema,
  invertOperation,
  newId,
  observationDraftSchema,
  observationIdSchema,
  observationSchema,
  operationIdSchema,
  operationSchema,
  projectIdSchema,
  evidenceManifestPath,
  type BundleEvidenceFile,
  type Evidence,
  type ImportJob,
  type ImportJobStatus,
  type ImportProposal,
  type ImportResolutionAction,
  type NetplanBundle,
  type Observation,
} from '@netplan/domain';
import type { Db } from '../db/index.js';
import {
  evidence as evidenceTable,
  evidenceBlobs,
  fieldProvenance,
  importJobs,
  importProposals,
  observations,
  operationLog,
  projects,
} from '../db/schema.js';
import { OperationError, type Engine, type EngineTx } from '../engine/store.js';
import { insertProvenanceRows } from './provenance.js';
import {
  DEFAULT_PARSE_LIMITS,
  ParseLimitError,
  checkFileSize,
  guardedGunzip,
  startBudget,
  type ParseLimits,
} from './guards.js';
import { fixtureAdapter } from './adapters/fixture.js';
import { deviceStateAdapter } from './adapters/device-state.js';
import { ldifAdapter } from './adapters/ldif.js';
import { nmapXmlAdapter } from './adapters/nmap-xml.js';
import { tsharkFlowsAdapter } from './adapters/tshark-flows.js';
import { zeekConnAdapter } from './adapters/zeek-conn.js';
import type { Adapter } from './adapters/types.js';

/** Wire input of POST /projects/:id/imports. */
export const createImportBodySchema = z.object({
  filename: z.string().min(1),
  adapter: z.string().min(1),
  /** File content; text formats travel as utf8, binary as base64. */
  content: z.string(),
  encoding: z.enum(['utf8', 'base64', 'gzip+base64']).default('utf8'),
  collectedAt: z.iso.datetime().nullable().default(null),
  /** ADR-0019 opt-in: embed a binary capture's raw blob instead of hash-only. */
  retainRaw: z.boolean().default(false),
});
export type CreateImportBody = z.infer<typeof createImportBodySchema>;

export interface ImportJobDetail {
  job: ImportJob;
  evidence: Evidence[];
  observations: Observation[];
  proposal: ImportProposal | null;
}

export type ImportStore = ReturnType<typeof createImportStore>;

const BINARY_CAPTURE_EXTENSIONS = ['.pcap', '.pcapng', '.cap'];

function isBinaryCapture(filename: string): boolean {
  const lower = filename.toLowerCase();
  return BINARY_CAPTURE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function createImportStore(
  db: Db,
  engine: Engine,
  options: { limits?: Partial<ParseLimits>; adapters?: Adapter[] } = {},
) {
  const limits: ParseLimits = { ...DEFAULT_PARSE_LIMITS, ...options.limits };
  const adapters = new Map<string, Adapter>(
    (
      options.adapters ?? [
        fixtureAdapter,
        deviceStateAdapter,
        nmapXmlAdapter,
        tsharkFlowsAdapter,
        ldifAdapter,
        zeekConnAdapter,
      ]
    ).map((a) => [a.name, a]),
  );
  /** In-flight parse jobs, so tests and shutdown can await quiescence. */
  const inFlight = new Set<Promise<void>>();

  function requireProject(projectId: string): void {
    const row = db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    if (!row) throw new OperationError('NOT_FOUND', `Project ${projectId} not found`);
  }

  function getAdapter(name: string): Adapter {
    const adapter = adapters.get(name);
    if (!adapter) throw new OperationError('INVALID', `Unknown import adapter: ${name}`);
    return adapter;
  }

  /** Decode the uploaded content to the evidence file's actual bytes, limits enforced. */
  function decodeContent(body: CreateImportBody): Buffer {
    switch (body.encoding) {
      case 'utf8':
        return Buffer.from(body.content, 'utf8');
      case 'base64':
        return Buffer.from(body.content, 'base64');
      case 'gzip+base64': {
        const compressed = Buffer.from(body.content, 'base64');
        checkFileSize(compressed.length, limits);
        return guardedGunzip(compressed, limits);
      }
    }
  }

  function setStatus(
    jobId: string,
    status: ImportJobStatus,
    patch: { error?: string | null; finishedAt?: string | null } = {},
  ): void {
    db.update(importJobs)
      .set({ status, ...patch })
      .where(eq(importJobs.id, jobId))
      .run();
  }

  async function runParse(
    job: ImportJob,
    evidenceRecord: Evidence,
    content: string,
  ): Promise<void> {
    setStatus(job.id, 'parsing');
    const adapter = getAdapter(job.parserName);
    try {
      const budget = startBudget(limits);
      const drafts = await adapter.parse(content, { budget, limits });
      const rows = drafts.map((draft) => {
        const parsed = observationDraftSchema.parse(draft);
        return observationSchema.parse({
          ...parsed,
          id: newId(observationIdSchema),
          projectId: job.projectId,
          importJobId: job.id,
          evidenceId: evidenceRecord.id,
        });
      });
      // build the proposed ChangeSet against the committed graph (ADR-0021)
      const state = engine.getState(job.projectId);
      const candidates = buildCandidates(rows);
      const proposal = buildProposal(state, job, candidates, new Date().toISOString());
      db.transaction((tx) => {
        for (const row of rows) tx.insert(observations).values(row).run();
        tx.insert(importProposals).values(proposal).run();
      });
      setStatus(job.id, 'review');
    } catch (error) {
      const message =
        error instanceof ParseLimitError
          ? error.message
          : error instanceof Error
            ? `Parse failed: ${error.message}`
            : 'Parse failed';
      setStatus(job.id, 'failed', { error: message, finishedAt: new Date().toISOString() });
    }
  }

  /**
   * Ingest an evidence file and enqueue its parse (ADR-0019): hash-on-ingest,
   * split-by-class retention, then the parse runs off the request path — the
   * returned job is `pending`/`parsing` until the worker finishes.
   *
   * Execution strategy: an in-process cooperative worker (event-loop yields +
   * the guards.ts limits), not a separate thread/process. Every ADR-0019
   * limit is enforced and a hostile file fails the job, not the app — but a
   * parser that hard-crashes the runtime would still take the process down.
   * `runParse` is the seam: moving it into a worker thread changes nothing
   * above this line.
   */
  function createJob(projectId: string, body: CreateImportBody): ImportJob {
    requireProject(projectId);
    const adapter = getAdapter(body.adapter);
    const bytes = decodeContent(body);
    checkFileSize(bytes.length, limits);

    const now = new Date().toISOString();
    const contentClass = isBinaryCapture(body.filename) ? 'binaryCapture' : 'structured';
    const retention =
      contentClass === 'structured' || body.retainRaw ? ('inline' as const) : ('hashOnly' as const);
    const encoding = contentClass === 'binaryCapture' ? ('base64' as const) : ('utf8' as const);

    const job = importJobSchema.parse({
      id: newId(importJobIdSchema),
      projectId,
      status: 'pending',
      parserName: adapter.name,
      parserVersion: adapter.version,
      schemaVersion: adapter.schemaVersion,
      changeSetId: null,
      startedAt: now,
      finishedAt: null,
      error: null,
    });
    const record = evidenceSchema.parse({
      id: newId(evidenceIdSchema),
      projectId,
      importJobId: job.id,
      filename: body.filename,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
      contentClass,
      retention,
      chunkRef: null,
      parserName: adapter.name,
      parserVersion: adapter.version,
      collectedAt: body.collectedAt,
      importedAt: now,
    });

    db.transaction((tx) => {
      tx.insert(importJobs).values(job).run();
      tx.insert(evidenceTable).values(record).run();
      if (retention === 'inline') {
        tx.insert(evidenceBlobs)
          .values({ evidenceId: record.id, encoding, content: bytes.toString(encoding) })
          .run();
      }
    });

    const content = bytes.toString(encoding);
    // Yield to the event loop first: the API response leaves before parsing starts.
    const task = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => runParse(job, record, content))
      .finally(() => {
        inFlight.delete(task);
      });
    inFlight.add(task);
    return job;
  }

  /** Await all in-flight parse work (tests, graceful shutdown). */
  async function whenIdle(): Promise<void> {
    while (inFlight.size > 0) {
      await Promise.all([...inFlight]);
    }
  }

  function getJob(projectId: string, jobId: string): ImportJob {
    const row = db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, jobId), eq(importJobs.projectId, projectId)))
      .get();
    if (!row) throw new OperationError('NOT_FOUND', `ImportJob ${jobId} not found`);
    return importJobSchema.parse(row);
  }

  function listJobs(projectId: string): ImportJob[] {
    requireProject(projectId);
    return db
      .select()
      .from(importJobs)
      .where(eq(importJobs.projectId, projectId))
      .orderBy(asc(importJobs.id))
      .all()
      .map((row) => importJobSchema.parse(row));
  }

  function listEvidence(projectId: string, jobId?: string): Evidence[] {
    return db
      .select()
      .from(evidenceTable)
      .where(
        jobId
          ? and(eq(evidenceTable.projectId, projectId), eq(evidenceTable.importJobId, jobId))
          : eq(evidenceTable.projectId, projectId),
      )
      .orderBy(asc(evidenceTable.id))
      .all()
      .map((row) => evidenceSchema.parse(row));
  }

  function listObservations(projectId: string, jobId: string): Observation[] {
    return db
      .select()
      .from(observations)
      .where(and(eq(observations.projectId, projectId), eq(observations.importJobId, jobId)))
      .orderBy(asc(observations.id))
      .all()
      .map((row) => observationSchema.parse(row));
  }

  function getProposal(projectId: string, jobId: string): ImportProposal | null {
    const row = db
      .select()
      .from(importProposals)
      .where(and(eq(importProposals.importJobId, jobId), eq(importProposals.projectId, projectId)))
      .get();
    return row ? importProposalSchema.parse(row) : null;
  }

  function getJobDetail(projectId: string, jobId: string): ImportJobDetail {
    const job = getJob(projectId, jobId);
    return {
      job,
      evidence: listEvidence(projectId, jobId),
      observations: listObservations(projectId, jobId),
      proposal: getProposal(projectId, jobId),
    };
  }

  // ---------- reconciliation: resolve → commit → rollback (ADR-0021) ----------

  function requireReviewJob(projectId: string, jobId: string): ImportJob {
    const job = getJob(projectId, jobId);
    if (job.status !== 'review') {
      throw new OperationError('CONFLICT', `ImportJob ${jobId} is ${job.status}, not review`);
    }
    return job;
  }

  function requireProposal(projectId: string, jobId: string): ImportProposal {
    const proposal = getProposal(projectId, jobId);
    if (!proposal) throw new OperationError('NOT_FOUND', `ImportJob ${jobId} has no proposal`);
    return proposal;
  }

  /** Rewrite the pending ChangeSet by resolving one conflict (ADR-0021). */
  function resolveConflict(
    projectId: string,
    jobId: string,
    conflictId: string,
    action: ImportResolutionAction,
  ): ImportProposal {
    requireReviewJob(projectId, jobId);
    const proposal = requireProposal(projectId, jobId);
    if (!proposal.conflicts.some((c) => c.id === conflictId)) {
      throw new OperationError('NOT_FOUND', `Conflict ${conflictId} not found`);
    }
    importResolutionActionSchema.parse(action);
    const state = engine.getState(projectId);
    const candidates = buildCandidates(listObservations(projectId, jobId));
    const next = importProposalSchema.parse({
      ...applyResolution(proposal, state, candidates, conflictId, action),
      updatedAt: new Date().toISOString(),
    });
    db.update(importProposals).set(next).where(eq(importProposals.importJobId, jobId)).run();
    return next;
  }

  /**
   * Apply the edited ChangeSet through the engine (the only entity write
   * path, ADR-0010), writing provenance rows and the job transition in the
   * same transaction. The applied ChangeSet is the rollback boundary.
   */
  function commit(projectId: string, jobId: string): ImportJobDetail {
    const job = requireReviewJob(projectId, jobId);
    const proposal = requireProposal(projectId, jobId);
    const pending = proposal.conflicts.filter((c) => c.resolution === 'pending');
    if (pending.length > 0) {
      throw new OperationError(
        'CONFLICT',
        `Cannot commit: ${pending.length} unresolved conflict(s) — the queue never auto-merges`,
      );
    }
    const now = new Date().toISOString();
    const observationRows = listObservations(projectId, jobId);
    const candidates = buildCandidates(observationRows);
    const provenanceRows = generateProvenanceRows(
      proposal,
      candidates,
      new Map(observationRows.map((o) => [o.id, o])),
      job,
      now,
    );
    const finishJob = (tx: EngineTx) => {
      insertProvenanceRows(tx, provenanceRows);
      tx.update(importJobs)
        .set({ status: 'committed', changeSetId: proposal.changeSetId, finishedAt: now })
        .where(eq(importJobs.id, jobId))
        .run();
    };

    if (proposal.operations.length === 0) {
      // everything was merged without field changes or ignored — nothing to
      // apply, but provenance and the job transition still land atomically
      engine.withTransaction((tx) => finishJob(tx));
    } else {
      engine.applyChangeSetWith(
        {
          id: changeSetIdSchema.parse(proposal.changeSetId),
          projectId: proposal.projectId,
          label: proposal.label,
          operations: proposal.operations,
        },
        finishJob,
      );
    }
    return getJobDetail(projectId, jobId);
  }

  /** Rollback = inverting the import's ChangeSet as one unit (ADR-0010/0021). */
  function rollback(projectId: string, jobId: string): ImportJobDetail {
    const job = getJob(projectId, jobId);
    if (job.status !== 'committed') {
      throw new OperationError('CONFLICT', `ImportJob ${jobId} is ${job.status}, not committed`);
    }
    const now = new Date().toISOString();
    const finishJob = (tx: EngineTx) => {
      // the imported values are being restored — their provenance goes with them
      tx.delete(fieldProvenance).where(eq(fieldProvenance.importJobId, jobId)).run();
      tx.update(importJobs)
        .set({ status: 'rolledBack', finishedAt: now })
        .where(eq(importJobs.id, jobId))
        .run();
    };

    if (job.changeSetId === null) {
      engine.withTransaction((tx) => finishJob(tx));
      return getJobDetail(projectId, jobId);
    }

    const applied = db
      .select()
      .from(operationLog)
      .where(
        and(eq(operationLog.projectId, projectId), eq(operationLog.changeSetId, job.changeSetId)),
      )
      .orderBy(asc(operationLog.seq))
      .all()
      .filter((row) => row.role === 'do')
      .map((row) => operationSchema.parse(row.payload));

    const inverse = applied
      .slice()
      .reverse()
      .map((op) => invertOperation(op, newId(operationIdSchema)));

    engine.applyChangeSetWith(
      {
        id: newId(changeSetIdSchema),
        projectId: projectIdSchema.parse(projectId),
        label: `Rollback of import ${jobId.slice(0, 8)}`,
        operations: inverse,
      },
      finishJob,
    );
    return getJobDetail(projectId, jobId);
  }

  function getEvidenceBlob(
    projectId: string,
    evidenceId: string,
  ): { record: Evidence; encoding: 'utf8' | 'base64'; content: string } | null {
    const record = db
      .select()
      .from(evidenceTable)
      .where(and(eq(evidenceTable.id, evidenceId), eq(evidenceTable.projectId, projectId)))
      .get();
    if (!record) throw new OperationError('NOT_FOUND', `Evidence ${evidenceId} not found`);
    const blob = db
      .select()
      .from(evidenceBlobs)
      .where(eq(evidenceBlobs.evidenceId, evidenceId))
      .get();
    if (!blob) return null;
    return { record: evidenceSchema.parse(record), encoding: blob.encoding, content: blob.content };
  }

  // ---------- bundle attachment (ADR-0016 evidence subtree) ----------

  function exportAttachments(projectId: string): {
    evidence: BundleEvidenceFile[];
    importJobs: ImportJob[];
  } {
    const jobs = listJobs(projectId);
    const files: BundleEvidenceFile[] = listEvidence(projectId).map((record) => {
      const blob = db
        .select()
        .from(evidenceBlobs)
        .where(eq(evidenceBlobs.evidenceId, record.id))
        .get();
      return blob
        ? { record, encoding: blob.encoding, content: blob.content }
        : { record, encoding: 'utf8', content: null };
    });
    return { evidence: files, importJobs: jobs };
  }

  /**
   * Verify every inline evidence blob against its manifest hash — evidence
   * identity survives the trip or the import is rejected (§3.13). Pure check:
   * call it before any restore write so a bad bundle leaves no partial state.
   */
  function verifyEvidenceHashes(bundle: NetplanBundle): void {
    for (const file of bundle.evidence) {
      if (file.content === null) continue;
      const bytes = Buffer.from(file.content, file.encoding);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== file.record.sha256) {
        throw new OperationError(
          'INVALID',
          `Evidence ${evidenceManifestPath(file.record)} content does not match its manifest hash`,
        );
      }
    }
  }

  /** Restore the evidence subtree of an imported bundle. */
  function restoreAttachments(bundle: NetplanBundle): void {
    verifyEvidenceHashes(bundle);
    db.transaction((tx) => {
      for (const job of bundle.importJobs) {
        tx.insert(importJobs).values(importJobSchema.parse(job)).run();
      }
      for (const file of bundle.evidence) {
        const record = evidenceSchema.parse(file.record);
        tx.insert(evidenceTable).values(record).run();
        if (file.content !== null) {
          tx.insert(evidenceBlobs)
            .values({ evidenceId: record.id, encoding: file.encoding, content: file.content })
            .run();
        }
      }
    });
  }

  return {
    limits,
    createJob,
    whenIdle,
    getJob,
    listJobs,
    listEvidence,
    listObservations,
    getJobDetail,
    getProposal,
    resolveConflict,
    commit,
    rollback,
    getEvidenceBlob,
    exportAttachments,
    verifyEvidenceHashes,
    restoreAttachments,
  };
}
