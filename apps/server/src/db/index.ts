import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema.js';

/**
 * Locate the `drizzle` migrations folder by walking up from this module.
 * The relative depth differs between `tsx` (src/db/…) and the bundled build
 * (dist/…), so resolve by finding the folder rather than hard-coding `../..`.
 */
function findMigrationsFolder(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'drizzle');
    if (fs.existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the drizzle migrations folder');
}

const migrationsFolder = findMigrationsFolder();

export type Db = ReturnType<typeof createDb>['db'];

export function createDb(file: string) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite };
}
