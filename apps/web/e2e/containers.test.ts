import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

type Sized = { id: string; name: string; size: { width: number; height: number } | null };

async function fetchGraph(page: Page) {
  const [project] = await (await page.request.get('/api/projects')).json();
  return (await (await page.request.get(`/api/projects/${project.id}/graph`)).json()) as {
    sites: Sized[];
    zones: Sized[];
  };
}

/** Predict the deterministic next name before clicking the add button. */
function nextName(existing: { name: string }[], prefix: string): string {
  const names = new Set(existing.map((e) => e.name));
  let index = 1;
  while (names.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

async function addSite(page: Page): Promise<string> {
  const graph = await fetchGraph(page);
  const name = nextName(graph.sites, 'site');
  await page.getByTestId('add-site').click();
  await expect(page.getByTestId(`site-node-${name}`)).toBeVisible();
  await waitSaved(page);
  return name;
}

async function addZone(page: Page): Promise<string> {
  const graph = await fetchGraph(page);
  const name = nextName(graph.zones, 'zone');
  await page.getByTestId('add-zone').click();
  await expect(page.getByTestId(`zone-node-${name}`)).toBeVisible();
  await waitSaved(page);
  return name;
}

/** Drag a container's bottom-right resize grip by (dx, dy). */
async function dragResizeHandle(page: Page, testId: string, dx: number, dy: number) {
  const grip = page.getByTestId(testId);
  await expect(grip).toBeVisible();
  const box = await grip.boundingBox();
  if (!box) throw new Error(`no bounding box for ${testId}`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('Resizable Site & Zone containers (improvements M1, #58)', () => {
  test('a Site resizes by handle-drag, survives reload, and undoes', async ({ page }) => {
    await openApp(page);
    const siteName = await addSite(page);

    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`site-node-${siteName}`).click({ position: { x: 120, y: 16 } });
    await dragResizeHandle(page, `site-resize-${siteName}`, 90, 70);
    await waitSaved(page);

    // persisted through the Operation log
    let graph = await fetchGraph(page);
    const site = graph.sites.find((s) => s.name === siteName);
    if (!site?.size) throw new Error('site size was not persisted');
    expect(site.size.width).toBeGreaterThan(460);
    expect(site.size.height).toBeGreaterThan(300);

    // survives reload: the node renders at the persisted size
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    const wrapper = page.locator(`.react-flow__node[data-id="${site.id}"]`);
    await expect(wrapper).toHaveCSS('width', `${site.size.width}px`);
    await expect(wrapper).toHaveCSS('height', `${site.size.height}px`);

    // resize is one undoable Operation
    await page.getByTestId('undo-button').click();
    await waitSaved(page);
    graph = await fetchGraph(page);
    expect(graph.sites.find((s) => s.name === siteName)?.size).toBeNull();
  });

  test('a Zone resizes; shrinking a Site is clamped to its contained zones', async ({ page }) => {
    await openApp(page);
    // add-zone attaches to the first site — resize that one, not a fresh one
    let graph = await fetchGraph(page);
    const siteName = graph.sites[0]?.name ?? (await addSite(page));
    const zoneName = await addZone(page);

    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`zone-node-${zoneName}`).click({ position: { x: 60, y: 12 } });
    await dragResizeHandle(page, `zone-resize-${zoneName}`, 60, 50);
    await waitSaved(page);

    graph = await fetchGraph(page);
    const zone = graph.zones.find((z) => z.name === zoneName);
    if (!zone?.size) throw new Error('zone size was not persisted');
    expect(zone.size.width).toBeGreaterThan(200);
    expect(zone.size.height).toBeGreaterThan(150);

    // shrink the parent site far below its content: the clamp holds at the
    // zone bounding box (zone at 20,44 plus its rendered size) — children
    // are never relocated
    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`site-node-${siteName}`).click({ position: { x: 120, y: 16 } });
    await dragResizeHandle(page, `site-resize-${siteName}`, -1000, -1000);
    await waitSaved(page);

    graph = await fetchGraph(page);
    const site = graph.sites.find((s) => s.name === siteName);
    if (!site?.size) throw new Error('site size was not persisted after shrink');
    expect(site.size.width).toBeGreaterThanOrEqual(20 + zone.size.width);
    expect(site.size.height).toBeGreaterThanOrEqual(44 + zone.size.height);
    expect(site.size.width).toBeLessThan(460);
  });
});
