import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

/**
 * When NETPLAN_SERVE_WEB is set, serve the built SPA from this process too
 * (one local web-server process, ADR-0002). The path resolves the same from
 * both `dist/index.js` (built) and `src/index.ts` (tsx): apps/web/dist.
 */
function resolveWebRoot(): string | undefined {
  const flag = process.env.NETPLAN_SERVE_WEB;
  if (flag !== '1' && flag !== 'true') return undefined;
  const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  console.warn(
    `NETPLAN_SERVE_WEB is set but no built web app was found at ${candidate}. ` +
      `Run 'pnpm build' first (or use 'pnpm start' from the repo root).`,
  );
  return undefined;
}

const webRoot = resolveWebRoot();
const app = await buildApp({ serveWebRoot: webRoot });

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '127.0.0.1' });
app.log.info(
  `NetPlan Studio ${webRoot ? 'app (SPA + API)' : 'API'} listening on http://127.0.0.1:${port}`,
);
