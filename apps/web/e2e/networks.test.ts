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

async function addNetwork(page: Page): Promise<string> {
  // Predict the deterministic next VLAN name from authoritative state — the
  // DOM may still be mounting nodes when this runs.
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

async function operationLogLength(page: Page): Promise<number> {
  const projects = await page.request.get('/api/projects');
  const [project] = await projects.json();
  const log = await page.request.get(`/api/projects/${project.id}/log`);
  return (await log.json()).length;
}

test.describe('Membership & Containment (M6 DoD, ADR-0013)', () => {
  test('a dual-homed device shows membership in two VLANs simultaneously', async ({ page }) => {
    await openApp(page);
    const vlanA = await addNetwork(page);
    const vlanB = await addNetwork(page);
    const deviceName = await addDeviceViaLibrary(page, 'server');

    // give the device two interfaces, one per VLAN
    await page.getByTestId(`device-node-${deviceName}`).click();
    await page.getByTestId('add-interface').click();
    await expect(page.getByTestId('interface-eth0')).toBeVisible();
    await page.getByTestId('add-interface').click();
    await expect(page.getByTestId('interface-eth1')).toBeVisible();

    await page.getByTestId('interface-network-eth0').selectOption({ label: vlanA });
    await page.getByTestId('interface-network-eth1').selectOption({ label: vlanB });
    await waitSaved(page);

    // both membership chips and both membership edges exist at once
    const node = page.getByTestId(`device-node-${deviceName}`);
    await expect(node.getByTestId(`membership-chip-${vlanA}`)).toBeVisible();
    await expect(node.getByTestId(`membership-chip-${vlanB}`)).toBeVisible();
    await expect
      .poll(async () => page.locator('.react-flow__edge').count())
      .toBeGreaterThanOrEqual(2);
  });

  test('moving an interface between VLANs is exactly one Operation', async ({ page }) => {
    await openApp(page);
    const vlanA = await addNetwork(page);
    const vlanB = await addNetwork(page);
    const deviceName = await addDeviceViaLibrary(page, 'workstation');

    await page.getByTestId(`device-node-${deviceName}`).click();
    await page.getByTestId('add-interface').click();
    await expect(page.getByTestId('interface-eth0')).toBeVisible();
    await page.getByTestId('interface-network-eth0').selectOption({ label: vlanA });
    await waitSaved(page);

    const before = await operationLogLength(page);
    await page.getByTestId('interface-network-eth0').selectOption({ label: vlanB });
    await waitSaved(page);
    const after = await operationLogLength(page);

    expect(after - before).toBe(1);
  });

  test('a device sits in exactly one zone; collapsing the site hides it', async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        console.log('BROWSER:', msg.type(), msg.text().slice(0, 300));
      }
    });
    await openApp(page);
    await page.getByTestId('add-site').click();
    await waitSaved(page);
    await page.getByTestId('add-zone').click();
    await waitSaved(page);
    const deviceName = await addDeviceViaLibrary(page, 'nas');

    // assign to the zone via the inspector — single physical parent
    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`device-node-${deviceName}`).click();
    const zoneSelect = page.getByTestId('device-zone-select');
    const optionLabels = await zoneSelect.locator('option').allInnerTexts();
    const zoneOption = optionLabels.find((l) => l.includes('zone-'));
    if (!zoneOption) throw new Error('zone option not found');
    await zoneSelect.selectOption({ label: zoneOption });
    await waitSaved(page);
    await expect(zoneSelect).not.toHaveValue('');

    // collapse the site: the device node disappears
    const siteName = zoneOption.split(' / ')[0] ?? '';
    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTestId(`site-toggle-${siteName}`).click();
    await expect(page.getByTestId(`device-node-${deviceName}`)).toBeHidden();

    // expand again: it is back
    await page.getByTestId(`site-toggle-${siteName}`).click();
    await expect(page.getByTestId(`device-node-${deviceName}`)).toBeVisible();
  });

  test('logical layer toggle hides network nodes and membership edges', async ({ page }) => {
    await openApp(page);
    await addNetwork(page);
    await expect(page.locator('.network-node').first()).toBeVisible();

    await page.getByTestId('toggle-logical-layer').click();
    await expect(page.locator('.network-node')).toHaveCount(0);

    await page.getByTestId('toggle-logical-layer').click();
    await expect(page.locator('.network-node').first()).toBeVisible();
  });
});
