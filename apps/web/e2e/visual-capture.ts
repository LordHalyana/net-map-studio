/**
 * Visual-parity capture harness (M0, issue #42). Seeds the demo scene and
 * screenshots the shell plus fixed crops for side-by-side comparison with
 * docs/concept_design_netplanner.png.
 *
 * Not a Playwright test — run it against a running dev stack whose database
 * contains no earlier-created projects (the app always loads projects[0]):
 *
 *   NETPLAN_DB=e2e/.visual-data/visual.db pnpm --filter @netplan/server dev
 *   pnpm --filter @netplan/web dev
 *   pnpm --filter @netplan/web visual:capture
 *
 * Env: VISUAL_WEB (default http://127.0.0.1:5173), VISUAL_API (default
 * http://127.0.0.1:3001), VISUAL_OUT (default e2e/.visual).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { DEMO_PROJECT_NAME, seedDemoScene } from './demo-scene';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = process.env['VISUAL_WEB'] ?? 'http://127.0.0.1:5173';
const API = process.env['VISUAL_API'] ?? 'http://127.0.0.1:3001';
const OUT = process.env['VISUAL_OUT'] ?? path.join(here, '.visual');

// concept_design_netplanner.png is 1448×1086 — capture at the same proportions
const VIEWPORT = { width: 1448, height: 1086 };

async function main() {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`No server at ${API}. Start the dev stack first (see file header).`);
  }

  const project = await seedDemoScene(API);
  const projects: { id: string }[] = await (await fetch(`${API}/projects`)).json();
  if (projects[0]?.id !== project.id) {
    throw new Error(
      `"${DEMO_PROJECT_NAME}" is not the first project — the app would load a different one. ` +
        'Point the server at a fresh database (NETPLAN_DB) and retry.',
    );
  }

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(WEB);
  await page.waitForSelector('[data-testid="app-shell"]');
  // let React Flow measure, fit and settle
  await page.waitForSelector('.react-flow__node');
  await page.waitForTimeout(1200);

  const shot = (name: string, options: Parameters<typeof page.screenshot>[0] = {}) =>
    page.screenshot({ path: path.join(OUT, `${name}.png`), ...options });

  await shot('01-shell');

  const canvas = page.locator('.canvas-region');
  await shot('02-canvas', { clip: await canvas.boundingBox().then((b) => b ?? undefined) });

  // node close-up: zoom to 200% centred on the firewall
  await page.click('[data-testid="zoom-200"]');
  await page.waitForTimeout(600);
  await shot('03-nodes-closeup');
  await page.click('[data-testid="zoom-100"]');
  await page.waitForTimeout(400);

  // inspector with the firewall selected
  const firewall = page.locator('[data-testid="device-node-Firewall"]');
  await firewall.click();
  await page.waitForTimeout(500);
  await shot('04-inspector');

  // bottom panel: link info via the firewall→core trunk link, then rules tab
  const trunkEdge = page.locator('.react-flow__edge', { hasText: 'trunk' }).first();
  if (await trunkEdge.count()) {
    await trunkEdge.click({ force: true });
    await page.waitForTimeout(400);
    await shot('05-link-info');
  }
  await page.click('[data-testid="context-tab-rules"]');
  await page.waitForTimeout(400);
  await shot('06-rules-tab');

  await browser.close();
  console.log(`captured to ${OUT}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
