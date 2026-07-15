import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

/** Create a network via the library and rename it in the inspector. */
async function addNamedNetwork(page: Page, name: string, cidr?: string) {
  const [project] = await (await page.request.get('/api/projects')).json();
  const graph = await (await page.request.get(`/api/projects/${project.id}/graph`)).json();
  const names = new Set<string>(graph.networks.map((n: { name: string }) => n.name));
  let index = 1;
  while (names.has(`VLAN-${index * 10}`)) index += 1;
  const minted = `VLAN-${index * 10}`;

  await page.getByTestId('add-network').click();
  await expect(page.getByTestId(`network-node-${minted}`)).toBeVisible();
  await waitSaved(page);

  await page.locator('.react-flow__controls-fitview').click();
  await page.getByTestId(`network-node-${minted}`).click();
  await expect(page.getByTestId('inspector-network')).toBeVisible();
  await page.getByTestId('network-name-input').fill(name);
  await page.getByTestId('network-name-input').press('Enter');
  if (cidr) {
    const cidrInput = page.getByTestId('inspector-network').getByPlaceholder('10.0.10.0/24');
    await cidrInput.fill(cidr);
    await cidrInput.press('Enter');
  }
  await waitSaved(page);
}

async function createRule(
  page: Page,
  source: string,
  destination: string,
  action: string,
  serviceLabel?: string,
) {
  await page.getByTestId('context-tab-rules').click();
  await expect(page.getByTestId('new-rule-form')).toBeVisible();
  await page.getByTestId('rule-source-select').selectOption({ label: `⊞ ${source}` });
  await page.getByTestId('rule-destination-select').selectOption({ label: `⊞ ${destination}` });
  if (serviceLabel) {
    await page.getByTestId('rule-service-select').selectOption({ label: serviceLabel });
  }
  await page.getByTestId('rule-action-select').selectOption(action);
  await page.getByTestId('rule-create').click();
  await waitSaved(page);
}

test.describe('PolicyRules, Services & the rule editor (M8 DoD, §3.11)', () => {
  test('author an allow rule network-to-network plus a default deny; both persist', async ({
    page,
  }) => {
    await openApp(page);
    await addNamedNetwork(page, 'Staff-VLAN');
    await addNamedNetwork(page, 'Servers-VLAN');
    await addNamedNetwork(page, 'any', '0.0.0.0/0');

    // a Service to reference
    await page.getByTestId('context-tab-rules').click();
    await page.getByTestId('service-name-input').fill('HTTPS');
    await page.getByTestId('service-port-input').fill('443');
    await page.getByTestId('service-create').click();
    await waitSaved(page);
    await expect(page.getByTestId('service-list')).toContainText('HTTPS (tcp 443)');

    // allow Staff → Servers on HTTPS, logged
    await page.getByTestId('rule-logging-toggle').check();
    await createRule(page, 'Staff-VLAN', 'Servers-VLAN', 'allow', 'HTTPS (tcp 443)');
    // default deny any ↔ any
    await createRule(page, 'any', 'any', 'deny');

    const rows = page.getByTestId('rule-list').locator('.rule-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Staff-VLAN → Servers-VLAN');
    await expect(rows.first()).toContainText('HTTPS');
    await expect(rows.last()).toContainText('deny');

    // no warnings on this clean pair
    await expect(page.locator('.rule-row__warnings')).toHaveCount(0);

    // rules persist via Operations
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await page.getByTestId('context-tab-rules').click();
    await expect(page.getByTestId('rule-list').locator('.rule-row')).toHaveCount(2);
  });

  test('the validator flags a permissive any-to-any rule inline', async ({ page }) => {
    await openApp(page);

    await createRule(page, 'any', 'any', 'allow');

    const warning = page.locator('.rule-row__warnings li[data-warning="anyToAny"]');
    await expect(warning).toHaveCount(1);
    await expect(warning).toContainText('any source to any destination');

    // and contradicts the default deny on the same traffic
    await expect(page.locator('.rule-row__warnings li[data-warning="contradictory"]')).toHaveCount(
      2,
    );

    // clean up the bad rule; warnings disappear
    const badRow = page.locator('.rule-row', {
      has: page.locator('li[data-warning="anyToAny"]'),
    });
    await badRow.locator('button[title="Delete rule"]').click();
    await waitSaved(page);
    await expect(page.locator('.rule-row__warnings')).toHaveCount(0);
  });
});
