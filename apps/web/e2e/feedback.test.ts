import { test, expect, type Page } from './fixtures';

/**
 * Improvements M6 (#63): feedback sweep — toasts, saved-ago timestamp,
 * switch controls, persisted network color.
 */

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

async function addNetwork(page: Page): Promise<string> {
  const projects = await page.request.get('/api/projects');
  const [project] = await projects.json();
  const graph = await (await page.request.get(`/api/projects/${project.id}/graph`)).json();
  const names = new Set<string>(graph.networks.map((n: { name: string }) => n.name));
  let index = 1;
  while (names.has(`VLAN-${index * 10}`)) index += 1;
  const expected = `VLAN-${index * 10}`;
  await page.getByTestId('add-network').click();
  await expect(page.getByTestId(`network-node-${expected}`)).toBeVisible();
  await waitSaved(page);
  return expected;
}

test.describe('Visual consistency & feedback (improvements M6, #63)', () => {
  test('a save shows the relative timestamp beside the status', async ({ page }) => {
    await openApp(page);
    await addNetwork(page);
    await expect(page.getByTestId('saved-ago')).toContainText('just now');
  });

  test('a failed bundle import surfaces as an error toast', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('export-menu-toggle').click();
    await page.getByTestId('import-netplan').click();
    await page.getByTestId('import-file-input').setInputFiles({
      name: 'broken.netplan',
      mimeType: 'application/json',
      buffer: Buffer.from('{ not json', 'utf8'),
    });
    await expect(page.getByTestId('toast-error')).toBeVisible();
    // toasts dismiss on click
    await page.getByTestId('toast-dismiss').click();
    await expect(page.getByTestId('toast-error')).toHaveCount(0);
  });

  test('the pinned toggle is a switch control, not a bare checkbox', async ({ page }) => {
    await openApp(page);
    const nodes = page.locator('.react-flow__node');
    const before = await nodes.count();
    const namesBefore = await page.locator('.device-node__name').allTextContents();
    await page.getByTestId('library-item-router').click();
    await expect(nodes).toHaveCount(before + 1);
    await waitSaved(page);
    let added: string[] = [];
    await expect
      .poll(async () => {
        const namesNow = await page.locator('.device-node__name').allTextContents();
        added = namesNow.filter((n) => n && !namesBefore.includes(n));
        return added.length;
      })
      .toBe(1);
    const name = added[0];
    if (!name) throw new Error('router not found');

    // select via search — immune to canvas overlap in the shared database
    await page.getByTestId('global-search-input').fill(name);
    await page.getByTestId(`search-result-${name}`).click();
    const toggle = page.getByTestId('device-pinned-toggle');
    await expect(toggle).toBeAttached();
    await expect(page.locator('.switch', { has: toggle })).toBeVisible();
    await toggle.check();
    await waitSaved(page);
    await expect(toggle).toBeChecked();
  });

  test('a pinned network color persists and survives reload', async ({ page }) => {
    await openApp(page);
    const name = await addNetwork(page);
    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`network-node-${name}`).click();
    await expect(page.getByTestId('network-color-picker')).toBeVisible();

    await page.getByTestId('network-color-a06bff').click();
    await waitSaved(page);

    // persisted through the Operation log
    const [project] = await (await page.request.get('/api/projects')).json();
    const graph = await (await page.request.get(`/api/projects/${project.id}/graph`)).json();
    const network = graph.networks.find((n: { name: string }) => n.name === name);
    expect(network.color).toBe('#a06bff');

    // survives reload and shows as the selected swatch
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`network-node-${name}`).click();
    await expect(page.getByTestId('network-color-a06bff')).toHaveClass(/color-swatch--on/);

    // Auto returns to the hash palette
    await page.getByTestId('network-color-auto').click();
    await waitSaved(page);
    const graph2 = await (await page.request.get(`/api/projects/${project.id}/graph`)).json();
    expect(graph2.networks.find((n: { name: string }) => n.name === name).color).toBeNull();
  });
});
