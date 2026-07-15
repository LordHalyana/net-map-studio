import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

async function graphSnapshot(page: Page): Promise<string> {
  const [project] = await (await page.request.get('/api/projects')).json();
  const graph = await (await page.request.get(`/api/projects/${project.id}/graph`)).json();
  return JSON.stringify(graph);
}

async function addDeviceViaLibrary(page: Page, deviceType: string): Promise<string> {
  const nodes = page.locator('.react-flow__node');
  const before = await nodes.count();
  const namesBefore = await page.locator('.device-node__name').allInnerTexts();
  await page.getByTestId(`library-item-${deviceType}`).click();
  await expect(nodes).toHaveCount(before + 1);
  let added: string[] = [];
  await expect
    .poll(async () => {
      const namesNow = await page.locator('.device-node__name').allInnerTexts();
      added = namesNow.filter((n) => n && !namesBefore.includes(n));
      return added.length;
    })
    .toBe(1);
  await waitSaved(page);
  const name = added[0];
  if (!name) throw new Error('no new device name found');
  return name;
}

test.describe('undo/redo, ChangeSets & activity log (M9 DoD, ADR-0010)', () => {
  test('a 5-step edit undoes and redoes step by step with matching state', async ({ page }) => {
    await openApp(page);

    const snapshots: string[] = [await graphSnapshot(page)];

    // five distinct steps
    const name = await addDeviceViaLibrary(page, 'router'); // 1: create device
    snapshots.push(await graphSnapshot(page));

    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`device-node-${name}`).click();
    await page.getByTestId('device-vendor-input').fill('Juniper'); // 2: set vendor
    await page.getByTestId('device-vendor-input').press('Enter');
    await waitSaved(page);
    snapshots.push(await graphSnapshot(page));

    await page.getByTestId('device-criticality-select').selectOption('high'); // 3
    await waitSaved(page);
    snapshots.push(await graphSnapshot(page));

    await page.getByTestId('add-interface').click(); // 4: add interface
    await waitSaved(page);
    snapshots.push(await graphSnapshot(page));

    await page.getByTestId('add-network').click(); // 5: add network
    await waitSaved(page);
    snapshots.push(await graphSnapshot(page));

    // undo all five, state matching at every point
    for (let i = snapshots.length - 2; i >= 0; i--) {
      await page.getByTestId('undo-button').click();
      await expect.poll(() => graphSnapshot(page)).toBe(snapshots[i]);
    }

    // redo all five
    for (let i = 1; i < snapshots.length; i++) {
      await page.getByTestId('redo-button').click();
      await expect.poll(() => graphSnapshot(page)).toBe(snapshots[i]);
    }
    await expect(page.getByTestId('redo-button')).toBeDisabled();
  });

  test('a grouped ChangeSet (duplicate with interfaces) undoes atomically', async ({ page }) => {
    await openApp(page);
    const name = await addDeviceViaLibrary(page, 'server');

    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`device-node-${name}`).click();
    await page.getByTestId('add-interface').click();
    await waitSaved(page);

    const before = await graphSnapshot(page);
    const nodes = page.locator('.react-flow__node');
    const countBefore = await nodes.count();

    // duplicate = one ChangeSet carrying device + interface creates
    await page.getByTestId('duplicate-device').click();
    await expect(nodes).toHaveCount(countBefore + 1);
    await waitSaved(page);

    // one undo removes the whole unit
    await page.getByTestId('undo-button').click();
    await expect(nodes).toHaveCount(countBefore);
    await expect.poll(() => graphSnapshot(page)).toBe(before);
  });

  test('the activity log lists operations in order with roles', async ({ page }) => {
    await openApp(page);
    await addDeviceViaLibrary(page, 'printer');
    await page.getByTestId('undo-button').click();
    await waitSaved(page);
    await expect.poll(async () => (await page.request.get('/api/projects')).status()).toBe(200);

    await page.getByTestId('context-tab-activity').click();
    const rows = page.getByTestId('activity-log').locator('.activity-log__row');
    await expect(rows.first()).toContainText('Delete device'); // newest first: the undo
    await expect(rows.first()).toHaveClass(/--undo/);

    // seq numbers are strictly decreasing top-to-bottom (log order preserved)
    const seqs = await rows.locator('.activity-log__seq').allInnerTexts();
    const numbers = seqs.map((s) => Number.parseInt(s.replace('#', ''), 10));
    const sortedDesc = [...numbers].sort((a, b) => b - a);
    expect(numbers).toEqual(sortedDesc);
  });
});
