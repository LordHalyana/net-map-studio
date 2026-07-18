import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  applyResolution,
  buildCandidates,
  buildProposal,
  changeSetIdSchema,
  detectSecrets,
  evidenceIdSchema,
  evidenceSchema,
  generateProvenanceRows,
  importJobIdSchema,
  importJobSchema,
  importProposalSchema,
  importResolutionActionSchema,
  invertOperation,
  maskValue,
  NETPLAN_BUNDLE_VERSION,
  newId,
  observationDraftSchema,
  observationIdSchema,
  observationSchema,
  operationIdSchema,
  operationSchema,
  projectIdSchema,
  reportIdSchema,
  reportRecordSchema,
  secretMatchIdSchema,
  secretMatchSchema,
  evidenceManifestPath,
  DEFAULT_SECRETS_CONFIG,
  type BundleEvidenceFile,
  type Evidence,
  type ImportJob,
  type ImportJobStatus,
  type ImportProposal,
  type ImportResolutionAction,
  type NetplanBundle,
  type Observation,
  type Operation,
  type ProjectState,
  type ReportType,
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
  JobCancelledError,
  ParseLimitError,
  checkFileSize,
  guardedGunzip,
  startBudget,
  type ParseLimits,
} from './guards.js';
import { builtInAdapters } from './adapters/registry.js';
import type { Adapter } from './adapters/types.js';
import {
  createInlineAdapterRunner,
  createWorkerAdapterRunner,
  type AdapterRunner,
} from './worker-runner.js';

/** Wire input of POST /projects/:id/imports. */
export const createImportBodySchema = z.object({
  filename: z.string().min(1),
  adapter: z.string().min(1),
  /** File content; text formats travel as utf8, binary as base64. */
  content: z.string(),
  encoding: z.enum(['utf8', 'base64', 'gzip+base64']).default('utf8'),
  collectedAt: z.iso.datetime().nullable().default(null),
  /** ImportProfile for profile-driven adapters like netcat-text (M12, #69). */
  profileId: z.uuidv7().optional(),
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
  options: { limits?: Partial<ParseLimits>; adapters?: Adapter[]; runner?: AdapterRunner } = {},
) {
  const limits: ParseLimits = { ...DEFAULT_PARSE_LIMITS, ...options.limits };
  const adapters: ReadonlyMap<string, Adapter> = options.adapters
    ? new Map(options.adapters.map((a) => [a.name, a]))
    : builtInAdapters;
  // Adapter execution (M12, #69): built-in adapters run isolated in a worker
  // process; injected test adapters cannot cross a process boundary, so they
  // fall back to the in-process runner (which is also the injectable seam).
  const runner: AdapterRunner =
    options.runner ??
    (options.adapters ? createInlineAdapterRunner(adapters) : createWorkerAdapterRunner());
  /** In-flight parse jobs, so tests and shutdown can await quiescence. */
  const inFlight = new Set<Promise<void>>();

  /**
   * The parse queue (P4-M5): a bounded FIFO with a concurrency cap — the
   * queue-shaped seam ADR-0019 asks for. Swapping in worker threads or a
   * distributed queue replaces `pump` and nothing above it.
   */
  const queue: Array<{ jobId: string; run: () => Promise<void> }> = [];
  let running = 0;
  /** Jobs the operator asked to cancel; checked at every budget checkpoint. */
  const cancelRequested = new Set<string>();
  /** Jobs currently queued or running — the set resume() must respect. */
  const active = new Set<string>();

  function pump(): void {
    while (running < limits.maxConcurrentParses && queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      running += 1;
      void task.run().finally(() => {
        running -= 1;
        pump();
      });
    }
  }

  /** Backpressure (P4-M5): reject new work when queued + running hit the bound. */
  function ensureQueueCapacity(): void {
    if (active.size >= limits.maxQueuedParses) {
      throw new ParseLimitError(
        `Import queue is full (${limits.maxQueuedParses} jobs) — retry when current imports finish`,
      );
    }
  }

  /** Enqueue a parse with backpressure; the API response leaves before it runs. */
  function enqueueParse(
    job: ImportJob,
    evidenceRecord: Evidence,
    content: string,
    profile?: unknown,
  ): void {
    ensureQueueCapacity();
    active.add(job.id);
    let release: () => void = () => undefined;
    const tracker = new Promise<void>((resolve) => {
      release = resolve;
    });
    inFlight.add(tracker);
    queue.push({
      jobId: job.id,
      run: async () => {
        try {
          if (cancelRequested.has(job.id)) {
            finishCancel(job.id);
          } else {
            await runParse(job, evidenceRecord, content, profile);
          }
        } finally {
          active.delete(job.id);
          cancelRequested.delete(job.id);
          release();
          inFlight.delete(tracker);
        }
      },
    });
    setImmediate(pump);
  }

  function finishCancel(jobId: string): void {
    db.transaction((tx) => {
      // cancellation can land after observations were staged but before the
      // job flipped to review on a prior run — leave no partial rows behind
      tx.delete(importProposals).where(eq(importProposals.importJobId, jobId)).run();
      tx.delete(observations).where(eq(observations.importJobId, jobId)).run();
      tx.update(importJobs)
        .set({
          status: 'cancelled',
          progressStage: null,
          error: null,
          finishedAt: new Date().toISOString(),
        })
        .where(eq(importJobs.id, jobId))
        .run();
    });
  }

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
    patch: {
      error?: string | null;
      finishedAt?: string | null;
      progressStage?: ImportJob['progressStage'];
    } = {},
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
    profile?: unknown,
  ): Promise<void> {
    setStatus(job.id, 'parsing', { progressStage: 'parsing' });
    getAdapter(job.parserName); // fail fast on an unknown parser
    try {
      // parent-side budget: the cancellation window between parse and persist
      const budget = startBudget(limits, Date.now, {
        jobId: job.id,
        isCancelled: () => cancelRequested.has(job.id),
      });
      const drafts = await runner({
        adapterName: job.parserName,
        content,
        profile,
        limits,
        isCancelled: () => cancelRequested.has(job.id),
      });
      if (drafts.length > limits.maxObservations) {
        throw new ParseLimitError(
          `Parse produced ${drafts.length} observations, over the ${limits.maxObservations} bound — aggregate harder or split the capture`,
        );
      }
      setStatus(job.id, 'parsing', { progressStage: 'building' });
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
      budget.check(); // last cancellation window before anything persists
      setStatus(job.id, 'parsing', { progressStage: 'persisting' });
      db.transaction((tx) => {
        for (const row of rows) tx.insert(observations).values(row).run();
        tx.insert(importProposals).values(proposal).run();
      });
      setStatus(job.id, 'review', { progressStage: null });
    } catch (error) {
      if (error instanceof JobCancelledError) {
        finishCancel(job.id);
        return;
      }
      const message =
        error instanceof ParseLimitError
          ? error.message
          : error instanceof Error
            ? `Parse failed: ${error.message}`
            : 'Parse failed';
      setStatus(job.id, 'failed', {
        error: message,
        finishedAt: new Date().toISOString(),
        progressStage: null,
      });
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

    // profile-driven adapters (§3.6, M12 #69): resolve the ImportProfile now
    // so an unknown id fails the request, not the background job
    let profile: unknown;
    if (body.profileId) {
      const found = engine
        .getState(projectId)
        .importProfiles.find((candidate) => candidate.id === body.profileId);
      if (!found) {
        throw new OperationError('NOT_FOUND', `ImportProfile ${body.profileId} not found`);
      }
      profile = found;
    }

    const now = new Date().toISOString();
    const contentClass = isBinaryCapture(body.filename) ? 'binaryCapture' : 'structured';
    const retention =
      contentClass === 'structured' || body.retainRaw ? ('inline' as const) : ('hashOnly' as const);
    const encoding = contentClass === 'binaryCapture' ? ('base64' as const) : ('utf8' as const);

    // backpressure before anything persists — a full queue rejects the upload
    ensureQueueCapacity();

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
      progressStage: 'queued',
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

    enqueueParse(job, record, bytes.toString(encoding), profile);
    return job;
  }

  /**
   * Cancel a queued or running parse (P4-M5). Cooperative: the running job
   * stops at its next budget checkpoint; nothing has committed by then, so
   * cancellation never leaves a partial import. Queued jobs cancel instantly.
   */
  function cancel(projectId: string, jobId: string): ImportJob {
    const job = getJob(projectId, jobId);
    if (job.status !== 'pending' && job.status !== 'parsing') {
      throw new OperationError('CONFLICT', `ImportJob ${jobId} is ${job.status}, not cancellable`);
    }
    cancelRequested.add(jobId);
    const queuedIndex = queue.findIndex((t) => t.jobId === jobId);
    if (queuedIndex !== -1) {
      // not started yet — run the (now trivial) task in place to release trackers
      const [task] = queue.splice(queuedIndex, 1);
      if (task) void task.run();
    } else if (!active.has(jobId)) {
      // not queued, not running: an interrupted job from a previous process
      cancelRequested.delete(jobId);
      finishCancel(jobId);
    }
    return getJob(projectId, jobId);
  }

  /**
   * Resume a cancelled (or crash-interrupted pending/parsing) job (P4-M5) by
   * re-running the parse from the stored read-only Evidence blob — resumability
   * is a corollary of hash-anchored evidence retention (ADR-0019).
   */
  function resume(projectId: string, jobId: string): ImportJob {
    const job = getJob(projectId, jobId);
    if (active.has(jobId)) {
      throw new OperationError('CONFLICT', `ImportJob ${jobId} is already queued or running`);
    }
    if (job.status !== 'cancelled' && job.status !== 'pending' && job.status !== 'parsing') {
      throw new OperationError('CONFLICT', `ImportJob ${jobId} is ${job.status}, not resumable`);
    }
    const record = listEvidence(projectId, jobId)[0];
    if (!record) throw new OperationError('NOT_FOUND', `ImportJob ${jobId} has no evidence`);
    const blob = getEvidenceBlob(projectId, record.id);
    if (!blob) {
      throw new OperationError(
        'CONFLICT',
        `Cannot resume ${jobId}: evidence blob was not retained (retention: hashOnly)`,
      );
    }
    // the blob stores exactly what adapters were handed (utf8 text, or base64
    // text for binary captures) — resume re-feeds it verbatim
    cancelRequested.delete(jobId);
    db.transaction((tx) => {
      // a crash-interrupted run may have staged rows; the re-run replaces them
      tx.delete(importProposals).where(eq(importProposals.importJobId, jobId)).run();
      tx.delete(observations).where(eq(observations.importJobId, jobId)).run();
    });
    setStatus(jobId, 'pending', { progressStage: 'queued', error: null, finishedAt: null });
    enqueueParse(getJob(projectId, jobId), record, blob.content);
    return getJob(projectId, jobId);
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

  /**
   * Stream a `.netplan` bundle as JSON text chunks (ADR-0016; improvements
   * M14, #71): evidence blobs are read one at a time straight from the DB, so
   * a project with hundreds of MB of captures never materializes as one giant
   * base64 array or serialized string. Yields byte-identical output to
   * `makeBundle` so import round-trips are unaffected.
   */
  function* streamBundle(
    projectId: string,
    state: ProjectState,
    exportedAt: string,
  ): Generator<string> {
    const jobs = listJobs(projectId);
    const records = listEvidence(projectId);
    // the manifest lists every record's hash — retained even when its blob is not
    const manifest = {
      files: records.map((r) => ({ path: evidenceManifestPath(r), sha256: r.sha256 })),
    };
    yield '{"format":"netplan"';
    yield `,"version":${NETPLAN_BUNDLE_VERSION}`;
    yield `,"exportedAt":${JSON.stringify(exportedAt)}`;
    yield `,"project":${JSON.stringify(state)}`;
    yield `,"importJobs":${JSON.stringify(jobs)}`;
    yield `,"manifest":${JSON.stringify(manifest)}`;
    yield ',"evidence":[';
    let first = true;
    for (const record of records) {
      const blob = db
        .select()
        .from(evidenceBlobs)
        .where(eq(evidenceBlobs.evidenceId, record.id))
        .get();
      const file: BundleEvidenceFile = blob
        ? { record, encoding: blob.encoding, content: blob.content }
        : { record, encoding: 'utf8', content: null };
      yield `${first ? '' : ','}${JSON.stringify(file)}`;
      first = false;
    }
    yield ']}';
  }

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

  // ---------- privacy & audit (§3.13; improvements M13, #70) ----------

  /** Append a §3.13 audit event to the Report table (the audit hook, M11). */
  function writeAudit(
    projectId: string,
    type: ReportType,
    parameters: Record<string, string>,
  ): void {
    engine.applyOperation({
      id: newId(operationIdSchema),
      projectId: projectIdSchema.parse(projectId),
      kind: 'CreateEntity',
      payload: {
        entityType: 'report',
        entity: reportRecordSchema.parse({
          id: newId(reportIdSchema),
          projectId,
          type,
          createdAt: new Date().toISOString(),
          redactionProfile: '',
          parameters,
          outputSha256: '',
        }),
      },
    });
  }

  /**
   * Detect secrets across retained evidence and persist them masked-by-default
   * (§3.13). The raw value never lands — only its mask, kind and
   * (evidenceId, offset, length) so an audited reveal can re-read the original
   * from the source blob. Idempotent per (evidence, offset).
   *
   * Scoped and batched (#110 C2): `jobId` limits the scan to one ImportJob's
   * Evidence — commit latency no longer grows with every previous import —
   * and all new detections land as ONE ChangeSet: one transaction, one
   * activity-log entry, one undo unit, still fully on the operation log
   * (ADR-0010).
   */
  function scanEvidenceSecrets(projectId: string, jobId?: string): number {
    const existing = new Set(
      engine.getState(projectId).secretMatches.map((s) => `${s.evidenceId}:${s.offset}`),
    );
    const operations: Operation[] = [];
    for (const record of listEvidence(projectId, jobId)) {
      const blob = getEvidenceBlob(projectId, record.id);
      if (!blob) continue; // hashOnly — nothing to scan
      const text =
        blob.encoding === 'base64'
          ? Buffer.from(blob.content, 'base64').toString('utf8')
          : blob.content;
      for (const found of detectSecrets(text, DEFAULT_SECRETS_CONFIG)) {
        const key = `${record.id}:${found.index}`;
        if (existing.has(key)) continue;
        existing.add(key);
        operations.push({
          id: newId(operationIdSchema),
          projectId: projectIdSchema.parse(projectId),
          kind: 'CreateEntity',
          payload: {
            entityType: 'secretMatch',
            entity: secretMatchSchema.parse({
              id: newId(secretMatchIdSchema),
              projectId,
              kind: found.kind,
              label: found.label,
              masked: maskValue(found.value),
              evidenceId: record.id,
              offset: found.index,
              length: found.value.length,
              revealed: false,
            }),
          },
        });
      }
    }
    if (operations.length > 0) {
      engine.applyChangeSet({
        id: newId(changeSetIdSchema),
        projectId: projectIdSchema.parse(projectId),
        label: `Detected ${operations.length} secret${operations.length === 1 ? '' : 's'} in evidence`,
        operations,
      });
    }
    return operations.length;
  }

  /**
   * Reveal one masked secret — an explicit, audited action (§3.13). Re-reads
   * the original from its source evidence, flips `revealed`, writes an audit
   * record, and returns the raw value once. Fails if the evidence was purged.
   */
  function revealSecret(projectId: string, secretId: string): string {
    const match = engine.getState(projectId).secretMatches.find((s) => s.id === secretId);
    if (!match) throw new OperationError('NOT_FOUND', `Secret ${secretId} not found`);
    const blob = getEvidenceBlob(projectId, match.evidenceId);
    if (!blob) {
      throw new OperationError(
        'CONFLICT',
        'The source evidence was purged — the original value no longer exists',
      );
    }
    const text =
      blob.encoding === 'base64'
        ? Buffer.from(blob.content, 'base64').toString('utf8')
        : blob.content;
    const value = text.slice(match.offset, match.offset + match.length);
    if (!match.revealed) {
      engine.applyOperation({
        id: newId(operationIdSchema),
        projectId: projectIdSchema.parse(projectId),
        kind: 'SetField',
        entityType: 'secretMatch',
        entityId: secretId,
        field: 'revealed',
        value: true,
        previousValue: match.revealed,
      });
    }
    writeAudit(projectId, 'secretReveal', { secretId, kind: match.kind });
    return value;
  }

  /**
   * Secure deletion (§3.13): drop an evidence blob while preserving the
   * evidence record and its manifest hash — evidence *identity* survives, the
   * raw bytes do not. Non-undoable by design; the audit record is its only
   * trace. A secret whose source blob is gone can no longer be revealed
   * (see `revealSecret`), so its stored mask is now the only form it has.
   */
  function purgeEvidence(projectId: string, evidenceId: string): void {
    const record = db
      .select()
      .from(evidenceTable)
      .where(and(eq(evidenceTable.id, evidenceId), eq(evidenceTable.projectId, projectId)))
      .get();
    if (!record) throw new OperationError('NOT_FOUND', `Evidence ${evidenceId} not found`);
    db.transaction((tx) => {
      tx.delete(evidenceBlobs).where(eq(evidenceBlobs.evidenceId, evidenceId)).run();
      tx.update(evidenceTable)
        .set({ retention: 'hashOnly' })
        .where(eq(evidenceTable.id, evidenceId))
        .run();
    });
    writeAudit(projectId, 'evidencePurge', {
      evidenceId,
      sha256: record.sha256,
      filename: record.filename,
    });
  }

  /**
   * Retention sweep (§3.13): downgrade retained raw evidence older than
   * `maxAgeDays` to hashOnly, keeping the record and hash. Returns the count
   * downgraded and writes one audit record when it did anything.
   */
  function sweepRetention(projectId: string, maxAgeDays: number): number {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let purged = 0;
    for (const record of listEvidence(projectId)) {
      if (record.retention !== 'inline') continue;
      if (new Date(record.importedAt).getTime() >= cutoff) continue;
      db.transaction((tx) => {
        tx.delete(evidenceBlobs).where(eq(evidenceBlobs.evidenceId, record.id)).run();
        tx.update(evidenceTable)
          .set({ retention: 'hashOnly' })
          .where(eq(evidenceTable.id, record.id))
          .run();
      });
      purged += 1;
    }
    if (purged > 0) {
      writeAudit(projectId, 'retentionSweep', {
        maxAgeDays: String(maxAgeDays),
        purged: String(purged),
      });
    }
    return purged;
  }

  return {
    limits,
    createJob,
    cancel,
    resume,
    whenIdle,
    getJob,
    listJobs,
    scanEvidenceSecrets,
    revealSecret,
    purgeEvidence,
    sweepRetention,
    listEvidence,
    listObservations,
    getJobDetail,
    getProposal,
    resolveConflict,
    commit,
    rollback,
    getEvidenceBlob,
    exportAttachments,
    streamBundle,
    verifyEvidenceHashes,
    restoreAttachments,
  };
}
