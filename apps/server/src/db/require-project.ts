import { eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { projects } from './schema.js';
import { OperationError } from '../engine/store.js';

/** Guard shared by the stores that key rows by project (door, feeds, imports). */
export function requireProject(db: Db, projectId: string): void {
  const row = db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get();
  if (!row) throw new OperationError('NOT_FOUND', `Project ${projectId} not found`);
}
