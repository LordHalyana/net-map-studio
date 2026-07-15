import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import {
  applyRedaction,
  changeSetSchema,
  makeBundle,
  netplanBundleSchema,
  newId,
  operationSchema,
  projectIdSchema,
  projectSchema,
  settableEntityTypeSchema,
} from '@netplan/domain';
import { toCsv } from './export/csv.js';
import { buildHtmlReport } from './export/report.js';
import { createDb } from './db/index.js';
import { createEngine, OperationError } from './engine/store.js';
import { createImportBodySchema, createImportStore } from './imports/store.js';
import { createProvenanceStore, overrideFieldBodySchema } from './imports/provenance.js';
import { createFindingsService } from './findings/analysis-service.js';
import { ParseLimitError } from './imports/guards.js';
import { importResolutionActionSchema } from '@netplan/domain';

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
  const findingsService = createFindingsService(db, engine, importStore, provenanceStore);
  app.decorate('importStore', importStore);

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
    return makeBundle(state, new Date().toISOString(), importStore.exportAttachments(id));
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
  app.get('/projects/:id/findings', async (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return findingsService.analyze(id);
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
  ]);

  app.get('/projects/:id/export/csv/:entityType', async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    const params = z.object({ entityType: csvEntityTypes }).safeParse(request.params);
    if (!params.success) {
      throw new OperationError('INVALID', 'Unknown entity type for CSV export');
    }
    const state = engine.getState(id);
    const csv = toCsv(state[params.data.entityType]);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${params.data.entityType}.csv"`)
      .send(csv);
  });

  app.get('/projects/:id/report', async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    const html = buildHtmlReport(engine.getState(id), new Date().toISOString());
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
