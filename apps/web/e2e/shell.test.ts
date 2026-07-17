import { test, expect, type Page } from './fixtures';

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

test.describe('nav destinations I (improvements M10, #67)', () => {
  test('Overview shows counts and recent activity', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-overview').click();
    await expect(page.getByTestId('overview-panel')).toBeVisible();
    await expect(page.getByTestId('overview-devices')).toContainText('Devices');
    await expect(page.getByTestId('overview-networks')).toContainText('Networks');
    await expect(page.getByTestId('overview-activity')).toBeVisible();
    // the findings tile links into the Findings view
    await page.getByTestId('overview-findings').click();
    await expect(page.getByTestId('findings-panel')).toBeVisible();
  });

  test('Networks & VLANs lists networks; a row opens the inspector', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-networks').click();
    await expect(page.getByTestId('networks-panel')).toBeVisible();

    // create from the page, row selects, inspector opens with edit surface
    await page.getByTestId('networks-add').click();
    await expect(page.getByTestId('sync-status')).toHaveText('Saved');
    await expect(page.getByTestId('inspector-network')).toBeVisible();
    const row = page.locator('[data-testid^="network-row-"]').first();
    await row.click();
    await expect(page.getByTestId('inspector-network')).toBeVisible();
    await expect(page.getByTestId('network-name-input')).toBeVisible();
  });

  test('the Rules page shows the full table with endpoint/action filters', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-rules').click();
    await expect(page.getByTestId('rules-page')).toBeVisible();
    await expect(page.getByTestId('rules-filters')).toBeVisible();
    // an empty project renders the (empty) table shell
    await expect(page.getByTestId('rule-list')).toBeAttached();

    // action filter narrows the visible set
    await page.getByTestId('rules-filter-action').selectOption('reject');
    await expect(page.getByTestId('rules-filter-count')).toContainText('0 of');
    await page.getByTestId('rules-filter-action').selectOption('');
  });
});

test.describe('nav destinations II (improvements M11, #68)', () => {
  test('Reports generates a bundle and lists the Report record', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-reports').click();
    await expect(page.getByTestId('reports-panel')).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByTestId('reports-generate-bundle').click();
    expect((await download).suggestedFilename()).toMatch(/\.netplan$/);

    // the server wrote a Report record; the panel refreshes its mirror
    await expect
      .poll(async () => page.locator('[data-testid^="report-record-"]').count(), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    await expect(page.getByTestId('reports-table')).toContainText('bundle');
  });

  test('identities and flows CSVs download from the Reports page', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-reports').click();
    for (const entity of ['identities', 'flows'] as const) {
      const download = page.waitForEvent('download');
      await page.getByTestId(`reports-csv-${entity}`).click();
      expect((await download).suggestedFilename()).toBe(`${entity}.csv`);
    }
  });

  test('Settings surfaces existing config and links to egress', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await expect(page.getByTestId('settings-rule-config')).toContainText('Config version');
    await expect(page.getByTestId('settings-indicator-lists')).toBeVisible();
    await page.getByTestId('settings-open-egress').click();
    await expect(page.getByTestId('egress-panel')).toBeVisible();
  });
});
