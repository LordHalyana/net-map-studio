import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

test.describe('workspace shell (M4 DoD)', () => {
  test('loads in dark mode with all five regions', async ({ page }) => {
    await openApp(page);

    for (const region of [
      'command-bar',
      'library-panel',
      'canvas-region',
      'inspector-panel',
      'context-panel',
    ]) {
      await expect(page.getByTestId(region)).toBeVisible();
    }

    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // --bg: #0f1115
    expect(bodyBg).toBe('rgb(15, 17, 21)');
  });

  test('canvas pans, zooms and shows a minimap', async ({ page }) => {
    await openApp(page);

    const viewport = page.locator('.react-flow__viewport');
    await expect(viewport).toBeVisible();
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
    await expect(page.locator('.react-flow__controls')).toBeVisible();

    const before = await viewport.getAttribute('style');

    // pan by dragging the pane
    const pane = page.locator('.react-flow__pane');
    const box = await pane.boundingBox();
    if (!box) throw new Error('canvas pane not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 5 });
    await page.mouse.up();

    const afterPan = await viewport.getAttribute('style');
    expect(afterPan).not.toBe(before);

    // zoom via the controls button
    await page.locator('.react-flow__controls-zoomin').click();
    const afterZoom = await viewport.getAttribute('style');
    expect(afterZoom).not.toBe(afterPan);
  });

  test('creating a device appears optimistically and survives a reload', async ({ page }) => {
    await openApp(page);

    const nodes = page.locator('.react-flow__node');
    const countBefore = await nodes.count();

    await page.getByTestId('library-item-router').click();
    await expect(nodes).toHaveCount(countBefore + 1);

    // wait for the op to sync, then reload — the device must persist
    await expect(page.getByTestId('sync-status')).toHaveText('Saved');
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(countBefore + 1);
  });
});
