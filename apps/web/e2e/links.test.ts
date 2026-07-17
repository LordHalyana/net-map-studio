import { test, expect, type Page } from './fixtures';
import { newId, operationIdSchema } from '@netplan/domain';

/** Reposition a device through the API — keeps canvas geometry deterministic. */
async function moveDeviceViaApi(page: Page, deviceName: string, x: number, y: number) {
  const [project] = await (await page.request.get('/api/projects')).json();
  const graph = await (await page.request.get(`/api/projects/${project.id}/graph`)).json();
  const device = graph.devices.find((d: { name: string }) => d.name === deviceName);
  if (!device) throw new Error(`device ${deviceName} not found`);
  const res = await page.request.post(`/api/projects/${project.id}/operations`, {
    data: {
      id: newId(operationIdSchema),
      projectId: project.id,
      kind: 'SetField',
      entityType: 'device',
      entityId: device.id,
      field: 'position',
      value: { x, y },
      previousValue: device.position,
    },
  });
  if (!res.ok()) throw new Error(`move failed: ${res.status()}`);
}

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

/** Nodes created after mount can sit outside the fitted viewport — re-fit. */
async function fitCanvas(page: Page) {
  await page.locator('.react-flow__controls-fitview').click();
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

test.describe('connect mode: Links (M7 DoD, ADR-0011/0012)', () => {
  test('creates a physical Link between two device interfaces via connect mode', async ({
    page,
  }) => {
    await openApp(page);
    const a = await addDeviceViaLibrary(page, 'router');
    const b = await addDeviceViaLibrary(page, 'switch');

    await page.getByTestId('toggle-connect-mode').click();
    await expect(page.getByTestId('connect-form')).toBeVisible();
    await fitCanvas(page);

    // pick source device, add an interface for it
    await page.getByTestId(`device-node-${a}`).click();
    await page.getByTestId('connect-source-add-interface').click();
    await waitSaved(page);

    // pick destination device, add an interface for it
    await page.getByTestId(`device-node-${b}`).click();
    await page.getByTestId('connect-target-add-interface').click();
    await waitSaved(page);

    await page.getByTestId('connect-label').fill('uplink-1');
    await page.getByTestId('connect-create').click();
    await waitSaved(page);

    // the Link renders as an edge labelled with its label
    await expect(page.locator('.react-flow__edge', { hasText: 'uplink-1' })).toBeVisible();

    // and it survives a reload
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.locator('.react-flow__edge', { hasText: 'uplink-1' })).toBeVisible();
  });

  test('a Link cannot terminate on a Network (rejected in the UI)', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('add-network').click();
    await waitSaved(page);
    await page.getByTestId('toggle-connect-mode').click();
    await expect(page.getByTestId('connect-form')).toBeVisible();
    await fitCanvas(page);

    await page.locator('.network-node').first().click();
    // the rejection surfaces as a toast (M6, #63)
    await expect(page.getByTestId('toast-info')).toContainText('Interfaces');
    // Create stays disabled without two interface endpoints
    await expect(page.getByTestId('connect-create')).toBeDisabled();
  });

  test('two links between the same pair render as one expandable bundled edge', async ({
    page,
  }) => {
    await openApp(page);
    const a = await addDeviceViaLibrary(page, 'server');
    const b = await addDeviceViaLibrary(page, 'firewall');

    await page.getByTestId('toggle-connect-mode').click();
    await fitCanvas(page);

    for (const label of ['trunk-a', 'trunk-b'] as const) {
      await page.getByTestId(`device-node-${a}`).click();
      await page.getByTestId('connect-source-add-interface').click();
      await waitSaved(page);
      await page.getByTestId(`device-node-${b}`).click();
      await page.getByTestId('connect-target-add-interface').click();
      await waitSaved(page);
      await page.getByTestId('connect-label').fill(label);
      await page.getByTestId('connect-create').click();
      await waitSaved(page);
    }

    // one bundled edge labelled "2 links"
    const bundled = page.locator('.react-flow__edge', { hasText: '2 links' });
    await expect(bundled).toHaveCount(1);

    // expanding: move the pair into clear space (other tests' nodes could
    // overlap the edge), then click the edge midpoint — the default bezier
    // passes exactly through the midpoint of its endpoints
    await page.getByTestId('toggle-connect-mode').click();
    await moveDeviceViaApi(page, a, -700, 900);
    await moveDeviceViaApi(page, b, 700, 900);
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await fitCanvas(page);
    const boxA = await page.getByTestId(`device-node-${a}`).boundingBox();
    const boxB = await page.getByTestId(`device-node-${b}`).boundingBox();
    if (!boxA || !boxB) throw new Error('device nodes not visible');
    await page.mouse.click(
      (boxA.x + boxA.width / 2 + boxB.x + boxB.width / 2) / 2,
      (boxA.y + boxA.height / 2 + boxB.y + boxB.height / 2) / 2,
    );
    await expect(page.getByTestId('link-bundle-summary')).toContainText('2 links');
    await expect(page.getByTestId('link-details').locator('.link-list__item')).toHaveCount(2);
  });
});
