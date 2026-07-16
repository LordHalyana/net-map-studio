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
  // textContent, not innerText: the node renders names uppercase (M1) but
  // testids carry the raw name
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

test.describe('component library & device nodes (M5 DoD)', () => {
  test('drag a Router from the library onto the canvas', async ({ page }) => {
    await openApp(page);
    const nodes = page.locator('.react-flow__node');
    const before = await nodes.count();

    await page
      .getByTestId('library-item-router')
      .dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 320, y: 200 } });

    await expect(nodes).toHaveCount(before + 1);
    await waitSaved(page);
  });

  test('device node shows type glyph, lifecycle badge and empty evidence placeholders', async ({
    page,
  }) => {
    await openApp(page);
    const name = await addDeviceViaLibrary(page, 'firewall');
    const node = page.getByTestId(`device-node-${name}`);
    await expect(node.locator('.device-node__tile')).toBeVisible();
    // badge strip reveals on hover (visual-parity M1 badge policy)
    await node.hover();
    await expect(node.locator('.device-node__lifecycle')).toHaveText('PLN');
    await expect(node.getByTestId('badge-confidence')).toBeAttached();
    await expect(node.getByTestId('badge-evidence')).toBeAttached();
  });

  test('edit a device in the inspector; add an interface and IP; everything persists', async ({
    page,
  }) => {
    await openApp(page);
    const name = await addDeviceViaLibrary(page, 'router');

    await page.getByTestId(`device-node-${name}`).click();
    await expect(page.getByTestId('inspector-device')).toBeVisible();

    // rename + set vendor
    const newName = `edited-${Date.now() % 100000}`;
    await page.getByTestId('device-name-input').fill(newName);
    await page.getByTestId('device-name-input').press('Enter');
    await page.getByTestId('device-vendor-input').fill('Cisco');
    await page.getByTestId('device-vendor-input').press('Enter');
    await waitSaved(page);
    await expect(page.getByTestId(`device-node-${newName}`)).toBeVisible();

    // add an interface and an IP address
    await page.getByTestId('add-interface').click();
    await expect(page.getByTestId('interface-eth0')).toBeVisible();
    await page.getByTestId('address-input-eth0').fill('10.20.30.40');
    await page.getByTestId('address-add-eth0').click();
    await expect(page.getByTestId('address-10.20.30.40')).toBeVisible();
    await waitSaved(page);

    // everything survives a reload
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await page.getByTestId(`device-node-${newName}`).click();
    await expect(page.getByTestId('interface-eth0')).toBeVisible();
    await expect(page.getByTestId('address-10.20.30.40')).toBeVisible();
    await expect(page.getByTestId('device-vendor-input')).toHaveValue('Cisco');
  });

  test('duplicate and delete work from the inspector', async ({ page }) => {
    await openApp(page);
    const name = await addDeviceViaLibrary(page, 'switch');
    const nodes = page.locator('.react-flow__node');
    const count = await nodes.count();

    await page.getByTestId(`device-node-${name}`).click();
    await page.getByTestId('duplicate-device').click();
    await expect(nodes).toHaveCount(count + 1);
    await expect(page.getByTestId(`device-node-${name}-copy`)).toBeVisible();
    await waitSaved(page);

    // delete the copy
    await page.getByTestId(`device-node-${name}-copy`).click();
    await page.getByTestId('delete-device').click();
    await expect(nodes).toHaveCount(count);
    await waitSaved(page);
  });

  test('multi-select shows bulk actions and keyboard delete removes devices', async ({ page }) => {
    await openApp(page);
    const a = await addDeviceViaLibrary(page, 'camera');
    const b = await addDeviceViaLibrary(page, 'printer');
    const nodes = page.locator('.react-flow__node');
    const count = await nodes.count();

    await page.getByTestId(`device-node-${a}`).click();
    await page.keyboard.down('Shift');
    await page.getByTestId(`device-node-${b}`).click();
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('inspector-multi')).toHaveText('2 devices selected');

    await page.keyboard.press('Delete');
    await expect(nodes).toHaveCount(count - 2);
    await waitSaved(page);
  });
});
