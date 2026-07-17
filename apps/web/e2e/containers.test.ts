import { test, expect, type Page } from './fixtures';
import { newId, operationIdSchema, zoneIdSchema, zoneSchema } from '@netplan/domain';

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

type FullGraph = {
  sites: { id: string; name: string }[];
  zones: { id: string; name: string; siteId: string }[];
  devices: { id: string; name: string; zoneId: string | null }[];
};

async function fetchFullGraph(page: Page): Promise<FullGraph & { projectId: string }> {
  const [project] = await (await page.request.get('/api/projects')).json();
  const graph = (await (
    await page.request.get(`/api/projects/${project.id}/graph`)
  ).json()) as FullGraph;
  return { ...graph, projectId: project.id as string };
}

/** Copy of inspector.test.ts's helper: click a library tile, return the new name. */
async function addDeviceViaLibrary(page: Page, deviceType: string): Promise<string> {
  const nodes = page.locator('.react-flow__node');
  const before = await nodes.count();
  const namesBefore = await page.locator('.device-node__name').allTextContents();
  await page.getByTestId(`library-item-${deviceType}`).click();
  await expect(nodes).toHaveCount(before + 1);
  let added: string[] = [];
  await expect
    .poll(async () => {
      const namesNow = await page.locator('.device-node__name').allTextContents();
      added = namesNow.filter((n) => n && !namesBefore.includes(n));
      return added.length;
    })
    .toBe(1);
  await waitSaved(page);
  const name = added[0];
  if (!name) throw new Error('no new device name found');
  return name;
}

/** The add-zone button always attaches to sites[0]; cascade tests need a zone
 *  on a specific fresh site, so arrange that through the API. */
async function addZoneToSiteViaApi(page: Page, siteName: string): Promise<string> {
  const graph = await fetchFullGraph(page);
  const site = graph.sites.find((s) => s.name === siteName);
  if (!site) throw new Error(`site ${siteName} not found`);
  const name = nextName(graph.zones, 'zone');
  const zone = zoneSchema.parse({
    id: newId(zoneIdSchema),
    projectId: graph.projectId,
    siteId: site.id,
    name,
    position: { x: 20, y: 44 },
  });
  const response = await page.request.post(`/api/projects/${graph.projectId}/operations`, {
    data: {
      id: newId(operationIdSchema),
      projectId: graph.projectId,
      kind: 'CreateEntity',
      payload: { entityType: 'zone', entity: zone },
    },
  });
  if (!response.ok()) throw new Error(`zone create failed: ${response.status()}`);
  return name;
}

test.describe('Site & Zone delete from the inspector (ui-polish M3)', () => {
  test('deleting a zone unparents its device; cancel is a no-op; undo restores', async ({
    page,
  }) => {
    await openApp(page);
    let graph = await fetchFullGraph(page);
    if (graph.sites.length === 0) await addSite(page);
    const zoneName = await addZone(page);
    const deviceName = await addDeviceViaLibrary(page, 'server');

    // place the device in the zone via the inspector's containment select
    graph = await fetchFullGraph(page);
    const zone = graph.zones.find((z) => z.name === zoneName);
    if (!zone) throw new Error('zone not found after add');
    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`device-node-${deviceName}`).click();
    await page.getByTestId('device-zone-select').selectOption(zone.id);
    await waitSaved(page);

    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`zone-node-${zoneName}`).click({ position: { x: 60, y: 12 } });
    await expect(page.getByTestId('inspector-zone')).toBeVisible();

    // cancel path: dialog closes, nothing changes
    await page.getByTestId('inspector-delete-zone').click();
    const dialog = page.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('1 device will stay on the canvas');
    await page.getByTestId('confirm-dialog-cancel').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId(`zone-node-${zoneName}`)).toBeVisible();

    // confirm path: zone gone, device survives unparented — one changeset
    await page.getByTestId('inspector-delete-zone').click();
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page.getByTestId(`zone-node-${zoneName}`)).not.toBeVisible();
    await waitSaved(page);
    graph = await fetchFullGraph(page);
    expect(graph.zones.find((z) => z.name === zoneName)).toBeUndefined();
    expect(graph.devices.find((d) => d.name === deviceName)?.zoneId).toBeNull();

    // undo restores the zone and the containment in one step
    await page.getByTestId('undo-button').click();
    await waitSaved(page);
    graph = await fetchFullGraph(page);
    expect(graph.zones.find((z) => z.name === zoneName)).toBeDefined();
    expect(graph.devices.find((d) => d.name === deviceName)?.zoneId).toBe(zone.id);
  });

  test('deleting a site cascades its zones', async ({ page }) => {
    await openApp(page);
    // the shortcut card overlays the canvas top-right, where fit-view puts
    // this test's site corner — clear it out of the way first
    await page.getByTestId('hotkey-card-dismiss').click();
    const siteName = await addSite(page);
    const zoneName = await addZoneToSiteViaApi(page, siteName);
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId(`zone-node-${zoneName}`)).toBeVisible();

    await page.locator('.react-flow__controls-fitview').click();
    // sites stack at small offsets, so a neighbouring container can cover the
    // header's left side — click the top-right corner, which stays exposed
    const siteNode = page.getByTestId(`site-node-${siteName}`);
    await expect(siteNode).toBeVisible();
    const box = await siteNode.boundingBox();
    if (!box) throw new Error('no bounding box for site node');
    await page.mouse.click(box.x + box.width - 12, box.y + 10);
    await expect(page.getByTestId('inspector-site')).toBeVisible();

    await page.getByTestId('inspector-delete-site').click();
    const dialog = page.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('1 zone will be deleted');
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page.getByTestId(`site-node-${siteName}`)).not.toBeVisible();
    await waitSaved(page);

    const graph = await fetchFullGraph(page);
    expect(graph.sites.find((s) => s.name === siteName)).toBeUndefined();
    expect(graph.zones.find((z) => z.name === zoneName)).toBeUndefined();
  });
});
