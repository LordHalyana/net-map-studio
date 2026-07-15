import Fastify from 'fastify';
import { z } from 'zod';
import {
  changeSetSchema,
  newId,
  operationSchema,
  projectIdSchema,
  projectSchema,
  settableEntityTypeSchema,
} from '@netplan/domain';
import { createDb } from './db/index.js';
import { createEngine, OperationError } from './engine/store.js';

export interface AppOptions {
  dbFile?: string;
  logger?: boolean;
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
  }
}

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const { db } = createDb(options.dbFile ?? process.env.NETPLAN_DB ?? 'netplan.db');
  const engine = createEngine(db);

  const registeredRoutes: string[] = [];
  app.decorate('registeredRoutes', registeredRoutes);
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) registeredRoutes.push(`${method} ${route.url}`);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof OperationError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 400;
      return reply.status(status).send({ error: error.message, code: error.code });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'Validation failed', issues: error.issues });
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

  return app;
}
