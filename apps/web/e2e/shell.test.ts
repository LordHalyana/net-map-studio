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
    // --bg: #0b0e13 (visual-parity M0 tokens)
    expect(bodyBg).toBe('rgb(11, 14, 19)');
  });

  test('canvas pans, zooms and shows a minimap', async ({ page }) => {
    await openApp(page);

    const viewport = page.locator('.react-flow__viewport');
    await expect(viewport).toBeVisible();
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
    await expect(page.locator('.react-flow__controls')).toBeVisible();

    const before = await viewport.getAttribute('style');

    // pan by dragging the pane — from a spot where the pane itself is the hit
    // target (a device node from another test could sit at the centre)
    const pane = page.locator('.react-flow__pane');
    const box = await pane.boundingBox();
    if (!box) throw new Error('canvas pane not visible');
    const start = await page.evaluate(
      ({ x, y, width, height }) => {
        const candidates: [number, number][] = [
          [x + width / 2, y + 40],
          [x + width - 60, y + 60],
          [x + 60, y + height / 2],
          [x + width / 2, y + height / 2],
        ];
        for (const [cx, cy] of candidates) {
          const el = document.elementFromPoint(cx, cy);
          if (el?.classList.contains('react-flow__pane')) return { x: cx, y: cy };
        }
        return null;
      },
      { x: box.x, y: box.y, width: box.width, height: box.height },
    );
    if (!start) throw new Error('no empty pane spot found to pan from');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y + 80, { steps: 5 });
    await page.mouse.up();

    const afterPan = await viewport.getAttribute('style');
    expect(afterPan).not.toBe(before);

    // zoom via the controls button (zoom-out: fitView may already sit at max zoom)
    await page.locator('.react-flow__controls-zoomout').click();
    await expect.poll(async () => viewport.getAttribute('style')).not.toBe(afterPan);
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
