import { test, expect, type Page } from '@playwright/test';

/**
 * Improvements M5 (#62): findings on the canvas — severity badge on affected
 * devices, findings layer tint toggle, badge click → filtered Findings view.
 */

const REPORT = JSON.stringify({
  schemaVersion: '1.0.0',
  hosts: [
    {
      deviceId: 'guid-ws-m5-01',
      hostname: 'ws-m5-01',
      os: { name: 'Windows 11' },
      collectedAt: '2026-07-15T00:00:00.000Z',
      interfaces: [{ name: 'eth0', addresses: [{ value: '10.9.5.10', kind: 'ipv4' }] }],
      routes: [],
      arp: [],
      connections: [],
      listeningPorts: [{ protocol: 'tcp', port: 3389, process: 'TermService' }],
      localUsers: [{ name: 'casey' }],
      localGroups: [],
      administrators: [],
      sudoers: [],
      collection: { scope: ['interfaces', 'listeningPorts'], errors: [] },
      remoteAccess: [{ name: 'AnyDesk' }],
      fileInventory: [],
    },
  ],
});

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function importAndCommit(page: Page) {
  await page.getByTestId('nav-imports').click();
  await page.getByTestId('import-adapter-select').selectOption('device-state');
  await page.getByTestId('import-evidence-file-input').setInputFiles({
    name: 'report.json',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(REPORT, 'utf8'),
  });
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('import-commit-button').click();
  await expect(page.getByTestId('import-review')).toContainText('committed');
}

async function rollback(page: Page) {
  await page.getByTestId('nav-imports').click();
  await page.getByTestId('import-job-device-state-committed').click();
  await page.getByTestId('import-rollback-button').click();
  await expect(page.getByTestId('import-review')).toContainText('rolledBack');
}

test.describe('Findings on the canvas (improvements M5, #62)', () => {
  test('an affected device shows the severity tint, the badge, and badge click filters findings', async ({
    page,
  }) => {
    await openApp(page);
    await importAndCommit(page);

    // back to the canvas: the imported workstation carries the layer tint
    await page.getByTestId('nav-canvas').click();
    await page.locator('.react-flow__controls-fitview').click();
    const node = page.getByTestId('device-node-ws-m5-01');
    await expect(node).toBeVisible();
    await expect(node).toHaveClass(/device-node--finding-/, { timeout: 15_000 });

    // findings layer toggle suppresses the tint, badge cluster remains
    await page.getByTestId('toggle-findings-layer').click();
    await expect(node).not.toHaveClass(/device-node--finding-/);
    await page.getByTestId('toggle-findings-layer').click();
    await expect(node).toHaveClass(/device-node--finding-/);

    // the badge shows in the cluster (hover/selection policy) and its click
    // lands on the Findings view filtered to this device
    await node.click();
    const badge = page.getByTestId('device-node-ws-m5-01').getByTestId('badge-findings');
    await expect(badge).toBeVisible();
    await badge.click();

    await expect(page.getByTestId('findings-panel')).toBeVisible();
    await expect(page.getByTestId('findings-device-filter')).toContainText('ws-m5-01');
    const count = await page.getByTestId('findings-count').textContent();
    expect(count).toMatch(/^\d+ of \d+ findings$/);

    // every visible finding affects the filtered device
    for (const affected of await page
      .locator('.finding-detail dd:nth-of-type(2)')
      .allTextContents()) {
      expect(affected).toBe('ws-m5-01');
    }

    // clearing the chip restores the unfiltered list
    await page.getByTestId('findings-device-filter-clear').click();
    await expect(page.getByTestId('findings-device-filter')).toHaveCount(0);

    await rollback(page);
  });
});
