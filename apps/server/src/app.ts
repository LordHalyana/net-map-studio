import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import {
  applyRedaction,
  changeSetSchema,
  makeBundle,
  netplanBundleSchema,
  newId,
  operationIdSchema,
  operationSchema,
  projectIdSchema,
  projectSchema,
  reportIdSchema,
  reportRecordSchema,
  settableEntityTypeSchema,
  type ReportType,
} from '@netplan/domain';
import { buildChangeReport } from './export/change-report.js';
import { toCsv } from './export/csv.js';
import { buildHtmlReport } from './export/report.js';
import { createDb } from './db/index.js';
import { createEngine, OperationError } from './engine/store.js';
import { createImportBodySchema, createImportStore } from './imports/store.js';
import { createProvenanceStore, overrideFieldBodySchema } from './imports/provenance.js';
import { createFindingsService } from './findings/analysis-service.js';
import { buildFindingsReport, findingsToCsvRows } from './export/findings-report.js';
import { isFindingsRedactionProfile, redactFindings, type FindingView } from '@netplan/domain';
import { ParseLimitError } from './imports/guards.js';
import { importResolutionActionSchema } from '@netplan/domain';
import {
  EgressBlockedError,
  createEgressDoor,
  updateEgressSettingsBodySchema,
} from './egress/door.js';
import { stubProvider } from './egress/providers/stub.js';
import {
  createLocalFeedProvider,
  createLocalFeedStore,
  putLocalFeedBodySchema,
} from './egress/providers/local-feed.js';
import { createEnrichmentService, fetchEnrichmentBodySchema } from './egress/enrichment.js';

export interface AppOptions {
  dbFile?: string;
  logger?: boolean;
  /**
   * Absolute path to the built web app (`apps/web/dist`). When set, the
   * server serves the SPA and exposes the API from one process (ADR-0002).
   * The web client calls `/api/*`; those are rewritten to the bare API
   * routes below, so nothing here needs an `/api` prefix.
   */
  serveWebRoot?: string;
}

/** Strip a leading `/api` segment so the SPA can call `/api/*` on one origin. */
function stripApiPrefix(url: string): string {
  if (url === '/api') return '/';
  if (url.startsWith('/api/')) return url.slice('/api'.length);
  return url;
}

const createProjectBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
});

const projectParamsSchema = z.object({ id: z.uuidv7() });
const entityParamsSchema = z.object({
  id: z.uuidv7(),
  entityType: settableEntityTypeSchema,
  entityId: z.uuidv7(),
});
const searchQuerySchema = z.object({ q: z.string().default('') });

declare module 'fastify' {
  interface FastifyInstance {
    /** Every registered route as "METHOD /url" — lets tests prove no write route bypasses the engine. */
    registeredRoutes: string[];
    /** The import pipeline (ADR-0019); exposed so tests can await worker quiescence. */
    importStore: import('./imports/store.js').ImportStore;
    /** The single guarded egress chokepoint (ADR-0027). */
    egressDoor: import('./egress/door.js').EgressDoor;
  }
}

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    // Evidence uploads (ADR-0019) can be tens of MB; the import worker's own
    // file-size limits are the real gate, this just lets requests reach them.
    bodyLimit: 128 * 1024 * 1024,
    // Runs before routing; injected/test requests use bare paths and pass through.
    rewriteUrl: (req) => stripApiPrefix(req.url ?? '/'),
  });
  const { db } = createDb(options.dbFile ?? process.env.NETPLAN_DB ?? 'netplan.db');
  const engine = createEngine(db);
  const importStore = createImportStore(db, engine);
  const provenanceStore = createProvenanceStore(db, engine);
  const localFeedStore = createLocalFeedStore(db);
  const egressDoor = createEgressDoor(db, {
    providers: [stubProvider, createLocalFeedProvider(localFeedStore)],
  });
  const enrichmentService = createEnrichmentService(db, egressDoor);
  const findingsService = createFindingsService(db, engine, provenanceStore, enrichmentService);
  app.decorate('importStore', importStore);
  app.decorate('egressDoor', egressDoor);

  const registeredRoutes: string[] = [];
  app.decorate('registeredRoutes', registeredRoutes);
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) registeredRoutes.push(`${method} ${route.url}`);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ParseLimitError) {
      return reply.status(413).send({ error: error.message, code: 'LIMIT' });
    }
    if (error instanceof EgressBlockedError) {
      return reply.status(403).send({ error: error.message, code: 'EGRESS_BLOCKED' });
    }
    if (error instanceof OperationError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 400;
      return reply.status(status).send({ error: error.message, code: error.code });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'Validation failed', issues: error.issues });
    }
    // Fastify's own errors (body parsing, 404s, …) carry a proper status code.
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // ---------- Project CRUD (workspace bootstrap; all entity writes go through /operations) ----------

  app.post('/projects', async (request, reply) => {
    const body = createProjectBodySchema.parse(request.body ?? {});
    const project = engine.createProject(
      projectSchema.parse({
        id: newId(projectIdSchema),
        name: body.name,
        description: body.description,
        createdAt: new Date().toISOString(),
      }),
    );
    return reply.status(201).send(project);
  });

  app.get('/projects', async () => engine.listProjects());

  app.get('/projects/:id', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    const project = engine.getProject(id);
    if (!project) throw new OperationError('NOT_FOUND', `Project ${id} not found`);
    return project;
  });

  app.delete('/projects/:id', async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    engine.deleteProject(id);
    return reply.status(204).send();
  });

  // ---------- The single mutation surface (ADR-0010) ----------

  app.post('/projects/:id/operations', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    const body = request.body;
    const isChangeSet = typeof body === 'object' && body !== null && 'operations' in body;

    if (isChangeSet) {
      const parsed = changeSetSchema.safeParse(body);
      if (!parsed.success) {
        throw new OperationError('INVALID', `Invalid ChangeSet: ${parsed.error.message}`);
      }
      if (parsed.data.projectId !== id) {
        throw new OperationError('INVALID', 'ChangeSet projectId does not match URL');
      }
      const result = engine.applyChangeSet(parsed.data);
      return { ...result, state: engine.getState(id) };
    }

    const parsed = operationSchema.safeParse(body);
    if (!parsed.success) {
      throw new OperationError('INVALID', `Invalid Operation: ${parsed.error.message}`);
    }
    if (parsed.data.projectId !== id) {
      throw new OperationError('INVALID', 'Operation projectId does not match URL');
    }
    const result = engine.applyOperation(parsed.data);
    return { ...result, state: engine.getState(id) };
  });

  // ---------- Proposal ChangeSets & the sign-off seam (P4-M6, ADR-0026) ----------

  // Register a proposal shell (draft). Status transitions are Operations
  // (SetChangeSetReviewStatus via POST /operations); the engine refuses to
  // apply a registered proposal that is not approved.
  app.post('/projects/:id/changesets', async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    const body = z.object({ label: z.string().min(1) }).parse(request.body ?? {});
    return reply.status(201).send(engine.registerChangeSet(id, body.label));
  });

  app.get('/projects/:id/changesets', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return engine.listChangeSets(id);
  });

  app.post('/projects/:id/undo', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    const result = engine.undo(id);
    if (!result) throw new OperationError('CONFLICT', 'Nothing to undo');
    return { ...result, state: engine.getState(id) };
  });

  app.post('/projects/:id/redo', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    const result = engine.redo(id);
    if (!result) throw new OperationError('CONFLICT', 'Nothing to redo');
    return { ...result, state: engine.getState(id) };
  });

  // ---------- Export / import (ADR-0016, design §3.12) ----------

  app.get('/projects/:id/export', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    const query = z.object({ redact: z.string().default('') }).parse(request.query);
    let state = engine.getState(id);
    const fields = query.redact
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    if (fields.length > 0) {
      state = applyRedaction(state, { name: 'query', fields });
    }
    const bundle = makeBundle(state, new Date().toISOString(), importStore.exportAttachments(id));
    recordReport(id, 'bundle', query.redact, {}, JSON.stringify(bundle));
    return bundle;
  });

  app.post('/projects/import', async (request, reply) => {
    const parsed = netplanBundleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new OperationError('INVALID', `Invalid .netplan bundle: ${parsed.error.message}`);
    }
    importStore.verifyEvidenceHashes(parsed.data);
    const project = engine.importState(parsed.data.project);
    importStore.restoreAttachments(parsed.data);
    return reply.status(201).send(project);
  });

  // ---------- Evidence imports (ADR-0019): ingest, then parse off the request path ----------

  app.post('/projects/:id/imports', async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    const body = createImportBodySchema.parse(request.body ?? {});
    const job = importStore.createJob(id, body);
    return reply.status(202).send(job);
  });

  app.get('/projects/:id/imports', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return importStore.listJobs(id);
  });

  app.get('/projects/:id/imports/:jobId', async (request) => {
    const params = z.object({ id: z.uuidv7(), jobId: z.uuidv7() }).parse(request.params);
    return importStore.getJobDetail(params.id, params.jobId);
  });

  const jobParamsSchema = z.object({ id: z.uuidv7(), jobId: z.uuidv7() });

  // Reconciliation (ADR-0021): resolving edits the pending ChangeSet; commit
  // applies it through the engine; rollback inverts it as one unit.
  app.post('/projects/:id/imports/:jobId/resolve', async (request) => {
    const params = jobParamsSchema.parse(request.params);
    const body = z
      .object({ conflictId: z.uuidv7(), action: importResolutionActionSchema })
      .parse(request.body ?? {});
    return importStore.resolveConflict(params.id, params.jobId, body.conflictId, body.action);
  });

  // Worker control (P4-M5): cancel stops a queued/running parse before
  // anything commits; resume re-runs it from the stored Evidence blob.
  app.post('/projects/:id/imports/:jobId/cancel', async (request) => {
    const params = jobParamsSchema.parse(request.params);
    return importStore.cancel(params.id, params.jobId);
  });

  app.post('/projects/:id/imports/:jobId/resume', async (request) => {
    const params = jobParamsSchema.parse(request.params);
    return importStore.resume(params.id, params.jobId);
  });

  app.post('/projects/:id/imports/:jobId/commit', async (request) => {
    const params = jobParamsSchema.parse(request.params);
    const detail = importStore.commit(params.id, params.jobId);
    return { ...detail, state: engine.getState(params.id) };
  });

  app.post('/projects/:id/imports/:jobId/rollback', async (request) => {
    const params = jobParamsSchema.parse(request.params);
    const detail = importStore.rollback(params.id, params.jobId);
    return { ...detail, state: engine.getState(params.id) };
  });

  // Per-field provenance (ADR-0008), the inspector's evidence trace (M8)
  app.get('/projects/:id/provenance/:entityType/:entityId', async (request) => {
    const params = entityParamsSchema.parse(request.params);
    return provenanceStore.listForEntity(params.id, params.entityType, params.entityId);
  });

  app.get('/projects/:id/provenance', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return provenanceStore.listForProject(id);
  });

  // Manual override (M8): a SetField Operation + a manual provenance row,
  // applied through the engine in one transaction — undoable like any edit.
  app.post('/projects/:id/provenance/override', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    const body = overrideFieldBodySchema.parse(request.body ?? {});
    const result = provenanceStore.overrideField(id, body);
    return { ...result, state: engine.getState(id) };
  });

  // Security findings (ADR-0023, Phase 3): a pure recomputation over the
  // committed graph — detection never touches the Operation log. Findings are
  // always current, so there is no server-side run to trigger; disposition
  // changes go through POST /projects/:id/operations (SetFindingStatus/Note).
  /** Findings, optionally through the client-safe redaction profile (M12, Q15). */
  /**
   * Persist the §3.4 Report record through the Operation log (M11, #68):
   * every generated deliverable leaves an auditable, undoable trace with the
   * output's SHA-256 — also the audit hook M13 builds on.
   */
  function recordReport(
    projectId: string,
    type: ReportType,
    redactionProfile: string,
    parameters: Record<string, string>,
    output: string,
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
          redactionProfile,
          parameters,
          outputSha256: createHash('sha256').update(output).digest('hex'),
        }),
      },
    });
  }

  function analyzeWithRedaction(id: string, redactParam: unknown): FindingView[] {
    const findings = findingsService.analyze(id).findings;
    const profile =
      typeof redactParam === 'string' && isFindingsRedactionProfile(redactParam)
        ? redactParam
        : 'none';
    if (profile === 'none') return findings;
    const usernames = engine.getState(id).identities.map((i) => i.name);
    return redactFindings(findings, profile, usernames);
  }

  app.get('/projects/:id/findings', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    const query = z.object({ redact: z.string().optional() }).parse(request.query ?? {});
    const report = findingsService.analyze(id);
    if (query.redact) {
      return { ...report, findings: analyzeWithRedaction(id, query.redact) };
    }
    return report;
  });

  app.get('/projects/:id/report/findings', async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    const query = z.object({ redact: z.string().optional() }).parse(request.query ?? {});
    const report = findingsService.analyze(id);
    const findings = query.redact ? analyzeWithRedaction(id, query.redact) : report.findings;
    const html = buildFindingsReport(engine.getState(id), findings, new Date().toISOString(), {
      opSeq: report.opSeq,
      configHash: report.configHash,
    });
    recordReport(id, 'findingsReport', query.redact ?? '', {}, html);
    return reply.header('content-type', 'text/html; charset=utf-8').send(html);
  });

  // ---------- The egress door (ADR-0027): settings, disclosure gate, audit trail ----------

  app.get('/projects/:id/egress/settings', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return egressDoor.getSettings(id);
  });

  app.put('/projects/:id/egress/settings', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    const body = updateEgressSettingsBodySchema.parse(request.body ?? {});
    return egressDoor.updateSettings(id, body);
  });

  app.get('/projects/:id/egress/audit', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return egressDoor.listAudit(id);
  });

  // ---------- Threat-intel enrichment (P4-M2, ADR-0028) ----------

  // The operator-supplied local/offline IoC feed — the zero-egress mode that
  // keeps enrichment fully usable with the door shut.
  app.get('/projects/:id/threat-intel/feed', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return localFeedStore.get(id);
  });

  app.put('/projects/:id/threat-intel/feed', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    const body = putLocalFeedBodySchema.parse(request.body ?? {});
    return localFeedStore.put(id, body.entries);
  });

  // An enrichment fetch is a collection event through the door: gate + audit
  // happen there; the result lands as read-only Evidence. Detection never
  // triggers this — re-fetching is always an explicit operator action.
  app.post('/projects/:id/enrichments', async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    const body = fetchEnrichmentBodySchema.parse(request.body ?? {});
    const view = await enrichmentService.fetch(id, body);
    return reply.status(201).send(view);
  });

  app.get('/projects/:id/enrichments', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return enrichmentService.list(id);
  });

  app.get('/projects/:id/evidence', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return importStore.listEvidence(id);
  });

  app.get('/projects/:id/evidence/:evidenceId', async (request) => {
    const params = z.object({ id: z.uuidv7(), evidenceId: z.uuidv7() }).parse(request.params);
    const blob = importStore.getEvidenceBlob(params.id, params.evidenceId);
    if (!blob) {
      throw new OperationError(
        'NOT_FOUND',
        `Evidence ${params.evidenceId} has no stored blob (retention: hashOnly)`,
      );
    }
    return blob;
  });

  const csvEntityTypes = z.enum([
    'devices',
    'interfaces',
    'addresses',
    'networks',
    'services',
    'links',
    'policyRules',
    'identities',
    'flows',
    'findings',
  ]);

  app.get('/projects/:id/export/csv/:entityType', async (request, reply) => {
    // one parse for both segments (M11, #68 — retires the double-parse)
    const params = z
      .object({ id: z.string(), entityType: csvEntityTypes })
      .safeParse(request.params);
    if (!params.success) {
      throw new OperationError('INVALID', 'Unknown entity type for CSV export');
    }
    const { id, entityType } = params.data;
    const query = z.object({ redact: z.string().optional() }).parse(request.query ?? {});
    // Findings are derived — not a ProjectState collection — and flow through
    // the same redaction pipeline as every other export (M12).
    const rows =
      entityType === 'findings'
        ? findingsToCsvRows(engine.getState(id), analyzeWithRedaction(id, query.redact))
        : engine.getState(id)[entityType];
    const csv = toCsv(rows);
    recordReport(id, 'csv', query.redact ?? '', { entityType }, csv);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${entityType}.csv"`)
      .send(csv);
  });

  app.get('/projects/:id/report', async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    const query = z.object({ redact: z.string().optional() }).parse(request.query ?? {});
    const html = buildHtmlReport(engine.getState(id), new Date().toISOString(), {
      findings: analyzeWithRedaction(id, query.redact),
      redactionProfile: query.redact ?? '',
    });
    recordReport(id, 'designReport', query.redact ?? '', {}, html);
    return reply.header('content-type', 'text/html; charset=utf-8').send(html);
  });

  // AS-IS → TO-BE change report (design §3.12; improvements M11, #68)
  app.get('/projects/:id/report/change', async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    const html = buildChangeReport(
      engine.getState(id),
      engine.listChangeSets(id),
      engine.getLog(id),
      new Date().toISOString(),
    );
    recordReport(id, 'changeReport', '', {}, html);
    return reply.header('content-type', 'text/html; charset=utf-8').send(html);
  });

  // ---------- Reads ----------

  app.get('/projects/:id/graph', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return engine.getState(id);
  });

  app.get('/projects/:id/log', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    if (!engine.getProject(id)) throw new OperationError('NOT_FOUND', `Project ${id} not found`);
    return engine.getLog(id);
  });

  app.get('/projects/:id/availability', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return engine.availability(id);
  });

  app.get('/projects/:id/search', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    const { q } = searchQuerySchema.parse(request.query);
    return engine.search(id, q);
  });

  app.get('/projects/:id/entities/:entityType/:entityId', async (request) => {
    const params = entityParamsSchema.parse(request.params);
    return engine.getEntityWithRelationships(params.id, params.entityType, params.entityId);
  });

  // ---------- Static SPA (production single-process, ADR-0002) ----------

  if (options.serveWebRoot) {
    await app.register(fastifyStatic, { root: options.serveWebRoot, wildcard: false });
    // SPA fallback: unmatched GET navigations (no file extension) get index.html.
    // API routes that 404 throw OperationError and go through the error handler,
    // not here, so this never masks a real API not-found.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.includes('.')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  return app;
}
