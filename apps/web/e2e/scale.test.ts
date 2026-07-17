import { test, expect, type Page } from './fixtures';
import {
  changeSetIdSchema,
  deviceIdSchema,
  deviceSchema,
  interfaceIdSchema,
  interfaceSchema,
  linkIdSchema,
  linkSchema,
  newId,
  operationIdSchema,
  projectIdSchema,
  type Operation,
} from '@netplan/domain';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

async function currentProjectId(page: Page): Promise<string> {
  const [project] = await (await page.request.get('/api/projects')).json();
  return project.id;
}

/** Seed a 110-device topology with links through the API in one ChangeSet. */
async function seedLargeTopology(page: Page, rawProjectId: string) {
  const projectId = projectIdSchema.parse(rawProjectId);
  const ops: Operation[] = [];
  const opBase = () => ({ id: newId(operationIdSchema), projectId });
  const interfaces: string[] = [];

  for (let i = 0; i < 110; i++) {
    const device = deviceSchema.parse({
      id: newId(deviceIdSchema),
      projectId,
      name: `bulk-${i}`,
      deviceType: i % 10 === 0 ? 'switch' : 'workstation',
      position: { x: (i % 11) * 220, y: Math.floor(i / 11) * 130 },
    });
    ops.push({
      ...opBase(),
      kind: 'CreateEntity',
      payload: { entityType: 'device', entity: device },
    });
    const iface = interfaceSchema.parse({
      id: newId(interfaceIdSchema),
      projectId,
      deviceId: device.id,
      name: 'eth0',
    });
    interfaces.push(iface.id);
    ops.push({
      ...opBase(),
      kind: 'CreateEntity',
      payload: { entityType: 'interface', entity: iface },
    });
  }

  // star-ish links: every workstation to its decade switch
  for (let i = 0; i < 110; i++) {
    const hub = Math.floor(i / 10) * 10;
    if (i === hub) continue;
    const source = interfaces[i];
    const target = interfaces[hub];
    if (!source || !target) continue;
    const link = linkSchema.parse({
      id: newId(linkIdSchema),
      projectId,
      source: { kind: 'interface', id: source },
      target: { kind: 'interface', id: target },
      kind: 'cable',
    });
    ops.push({ ...opBase(), kind: 'CreateLink', link });
  }

  const response = await page.request.post(`/api/projects/${projectId}/operations`, {
    data: {
      id: newId(changeSetIdSchema),
      projectId,
      label: 'Seed 110-device topology',
      operations: ops,
    },
  });
  expect(response.ok()).toBe(true);
}

test.describe('scale, layout & polish (M11 DoD, acceptance #1)', () => {
  test('a 110-device project stays interactive: load, pan, zoom, select', async ({ page }) => {
    await openApp(page);
    const projectId = await currentProjectId(page);
    await seedLargeTopology(page, projectId);

    const started = Date.now();
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await page.locator('.react-flow__controls-fitview').click();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    const loaded = Date.now() - started;
    expect(loaded).toBeLessThan(15_000);

    // pan
    const pane = page.locator('.react-flow__pane');
    const box = await pane.boundingBox();
    if (!box) throw new Error('no pane');
    const viewport = page.locator('.react-flow__viewport');
    const before = await viewport.getAttribute('style');
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + 90, { steps: 4 });
    await page.mouse.up();
    expect(await viewport.getAttribute('style')).not.toBe(before);

    // zoom preset, then locate + select a node via search — culling means the
    // node may not be in the DOM until focused (that is the point)
    await page.getByTestId('zoom-100').click();
    const interactStart = Date.now();
    await page.getByTestId('global-search-input').fill('bulk-0');
    await page.getByTestId('search-result-bulk-0').click();
    await expect(page.getByTestId('inspector-device')).toBeVisible();
    expect(Date.now() - interactStart).toBeLessThan(5_000);
  });

  test('auto-arrange moves unpinned devices and leaves pinned ones alone', async ({ page }) => {
    await openApp(page);

    for (const type of ['router', 'switch', 'server'] as const) {
      await page.getByTestId(`library-item-${type}`).click();
      await waitSaved(page);
    }
    const projectId = await currentProjectId(page);
    const graph = await (await page.request.get(`/api/projects/${projectId}/graph`)).json();
    const devices: { id: string; name: string; position: { x: number; y: number } }[] =
      graph.devices;
    const pinnedTarget = devices.find((d) => d.name.startsWith('router'));
    if (!pinnedTarget) throw new Error('router not found');

    // pin the router via the inspector (select through search — with many
    // seeded devices the node may be sub-pixel small or culled)
    await page.getByTestId('global-search-input').fill(pinnedTarget.name);
    await page.getByTestId(`search-result-${pinnedTarget.name}`).click();
    await expect(page.getByTestId('inspector-device')).toBeVisible();
    await page.getByTestId('device-pinned-toggle').check();
    await waitSaved(page);

    await page.getByTestId('auto-arrange').click();
    await waitSaved(page);

    const after = await (await page.request.get(`/api/projects/${projectId}/graph`)).json();
    const findAfter = (id: string) =>
      after.devices.find((d: { id: string }) => d.id === id)?.position;

    expect(findAfter(pinnedTarget.id)).toEqual(pinnedTarget.position);
    const moved = devices.filter(
      (d) =>
        d.id !== pinnedTarget.id && JSON.stringify(findAfter(d.id)) !== JSON.stringify(d.position),
    );
    expect(moved.length).toBeGreaterThan(0);
  });

  test('global search locates a device, an IP and a VLAN', async ({ page }) => {
    await openApp(page);

    // named device with an IP, plus a network (names via API — with viewport
    // culling, off-screen nodes are not in the DOM)
    await page.getByTestId('library-item-firewall').click();
    await waitSaved(page);
    const projectId = await currentProjectId(page);
    const graph = await (await page.request.get(`/api/projects/${projectId}/graph`)).json();
    const firewall = graph.devices.find((d: { name: string }) => d.name.startsWith('firewall'));
    if (!firewall) throw new Error('firewall not found');
    const name: string = firewall.name;

    // select it via search (works regardless of viewport)
    await page.getByTestId('global-search-input').fill(name);
    await page.getByTestId(`search-result-${name}`).click();
    await expect(page.getByTestId('inspector-device')).toBeVisible();
    await page.getByTestId('device-name-input').fill('edge-fw-search');
    await page.getByTestId('device-name-input').press('Enter');
    await page.getByTestId('add-interface').click();
    await page.getByTestId('address-input-eth0').fill('10.99.88.77');
    await page.getByTestId('address-add-eth0').click();
    await waitSaved(page);
    await page.getByTestId('add-network').click();
    await waitSaved(page);

    // by device name
    await page.getByTestId('global-search-input').fill('edge-fw-search');
    await expect(page.getByTestId('search-result-edge-fw-search')).toBeVisible();
    await page.getByTestId('search-result-edge-fw-search').click();
    await expect(page.getByTestId('inspector-device')).toBeVisible();

    // by IP
    await page.getByTestId('global-search-input').fill('10.99.88');
    await expect(page.getByTestId('search-result-10.99.88.77')).toBeVisible();

    // by VLAN
    await page.getByTestId('global-search-input').fill('VLAN-');
    await expect(page.getByTestId('search-results').locator('li').first()).toBeVisible();
    await page.getByTestId('global-search-input').press('Escape');

    // by rule: create one with a searchable justification, result opens Rules tab
    await page.getByTestId('context-tab-rules').click();
    await page.getByTestId('rule-source-select').selectOption({ index: 1 });
    await page.getByTestId('rule-destination-select').selectOption({ index: 1 });
    await page.getByTestId('rule-justification-input').fill('pci-segmentation-x1');
    await page.getByTestId('rule-create').click();
    await waitSaved(page);
    await page.getByTestId('context-tab-details').click();

    await page.getByTestId('global-search-input').fill('pci-segmentation-x1');
    const ruleResult = page.getByTestId('search-results').locator('li').first();
    await expect(ruleResult).toContainText('rule');
    await ruleResult.locator('button').click();
    await expect(page.getByTestId('rules-panel')).toBeVisible();
  });
});
