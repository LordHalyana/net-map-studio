import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

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

test.describe('Keyboard shortcuts & canvas basics (improvements M2, #59)', () => {
  test('Ctrl+Z undoes and Ctrl+Y redoes a device creation', async ({ page }) => {
    await openApp(page);
    const name = await addDeviceViaLibrary(page, 'router');

    await page.keyboard.press('Control+z');
    await expect(page.getByTestId(`device-node-${name}`)).toHaveCount(0);

    await page.keyboard.press('Control+y');
    await expect(page.getByTestId(`device-node-${name}`)).toBeVisible();
    await waitSaved(page);
  });

  test('Ctrl+D duplicates and Ctrl+C/Ctrl+V pastes the selected device', async ({ page }) => {
    await openApp(page);
    const name = await addDeviceViaLibrary(page, 'switch');

    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`device-node-${name}`).click();
    await page.keyboard.press('Control+d');
    await expect(page.getByTestId(`device-node-${name}-copy`)).toBeVisible();
    await waitSaved(page);

    // copy/paste: the original is still selected; paste mints another copy
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId(`device-node-${name}-copy-2`)).toBeVisible();
    await waitSaved(page);
  });

  test('shortcuts are inert while typing in an input', async ({ page }) => {
    await openApp(page);
    const name = await addDeviceViaLibrary(page, 'nas');

    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`device-node-${name}`).click();
    const search = page.getByTestId('global-search-input');
    await search.click();
    await search.pressSequentially('zz');
    await page.keyboard.press('Control+d');
    await expect(page.getByTestId(`device-node-${name}-copy`)).toHaveCount(0);
  });

  test('/ focuses search, ? opens the cheat sheet, Escape closes it', async ({ page }) => {
    await openApp(page);
    await page.locator('.canvas-region').click({ position: { x: 5, y: 60 } });

    await page.keyboard.press('/');
    await expect(page.getByTestId('global-search-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByTestId('canvas-toolbar').click({ position: { x: 2, y: 2 } });

    await page.keyboard.press('Shift+?');
    await expect(page.getByTestId('shortcut-help')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcut-help')).toHaveCount(0);
  });

  test('grid toggle round-trips and controls the painted grid', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.react-flow__background')).toBeVisible();

    await page.getByTestId('toggle-grid').click();
    await expect(page.locator('.react-flow__background')).toHaveCount(0);
    await expect(page.getByTestId('toggle-grid')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('toggle-grid').click();
    await expect(page.locator('.react-flow__background')).toBeVisible();
    await expect(page.getByTestId('toggle-grid')).toHaveAttribute('aria-pressed', 'true');
  });

  test('fit-to-screen button changes the viewport transform', async ({ page }) => {
    await openApp(page);
    await addDeviceViaLibrary(page, 'camera');
    // 50% is never the fitted transform for this scene, so fit must move it
    await page.getByTestId('zoom-50').click();
    await page.waitForTimeout(400);
    const before = await page.locator('.react-flow__viewport').getAttribute('style');

    await page.getByTestId('fit-view').click();
    await expect
      .poll(async () => page.locator('.react-flow__viewport').getAttribute('style'))
      .not.toBe(before);
  });
});

test.describe('Canvas hotkey card (ui-polish M7)', () => {
  test('shows by default, dismiss persists across reload, settings re-enables', async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.getByTestId('hotkey-card')).toBeVisible();

    // dismiss hides it and the preference survives a reload
    await page.getByTestId('hotkey-card-dismiss').click();
    await expect(page.getByTestId('hotkey-card')).not.toBeVisible();
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('hotkey-card')).not.toBeVisible();

    // Settings → Interface turns it back on
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-hotkey-card')).toBeVisible();
    await page.getByTestId('settings-hotkey-card-toggle').click();
    await page.getByTestId('nav-canvas').click();
    await expect(page.getByTestId('hotkey-card')).toBeVisible();
  });
});
