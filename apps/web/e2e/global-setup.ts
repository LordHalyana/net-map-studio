import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const e2eDbFile = path.join(here, '.e2e-data', 'netplan-e2e.db');

/** The API server's own origin — the Vite proxy is not up in every context. */
export const apiBase = 'http://127.0.0.1:3001';

/** Delete every project through the API; the server cascades each delete
 *  across all project-scoped tables, leaving a genuinely empty store. */
export async function wipeAllProjects() {
  const response = await fetch(`${apiBase}/projects`);
  if (!response.ok)
    throw new Error(`Could not list projects to reset e2e state: ${response.status}`);
  const projects: { id: string }[] = await response.json();
  for (const project of projects) {
    const del = await fetch(`${apiBase}/projects/${project.id}`, { method: 'DELETE' });
    if (!del.ok) throw new Error(`Could not delete project ${project.id}: ${del.status}`);
  }
}

/**
 * Start every e2e run from an empty store. Depending on Playwright's startup
 * order the API server may already be running and holding the SQLite file,
 * so fall back to wiping projects through the API.
 */
export default async function globalSetup() {
  fs.mkdirSync(path.dirname(e2eDbFile), { recursive: true });
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${e2eDbFile}${suffix}`, { force: true });
    }
  } catch {
    await wipeAllProjects();
  }
}
