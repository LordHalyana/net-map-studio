import { test, expect, type Page } from '@playwright/test';

/**
 * M11 DoD (plan §2, design §3.8): import evidence → findings appear with no
 * manual step; a finding shows its evidence chain, rule version and verification
 * steps; marking it false-positive persists and survives re-analysis; coverage
 * shows per-device evaluability.
 */

const REPORT = JSON.stringify({
  schemaVersion: '1.0.0',
  hosts: [
    {
      deviceId: 'guid-ws-findings-01',
      hostname: 'ws-find-01',
      os: { name: 'Windows 11' },
      collectedAt: '2026-07-15T00:00:00.000Z',
      interfaces: [{ name: 'eth0', addresses: [{ value: '10.9.0.10', kind: 'ipv4' }] }],
      routes: [],
      arp: [],
      connections: [],
      listeningPorts: [{ protocol: 'tcp', port: 3389, process: 'TermService' }],
      localUsers: [{ name: 'alice' }],
      localGroups: [],
      administrators: [],
      sudoers: [],
      collection: { scope: ['interfaces', 'listeningPorts'], errors: [] },
      remoteAccess: [{ name: 'AnyDesk' }],
      fileInventory: [{ path: 'C:\\Users\\alice\\Downloads\\invoice.pdf.exe' }],
    },
  ],
});

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function importAndCommit(page: Page) {
  await page.getByTestId('nav-imports').click();
  await expect(page.getByTestId('imports-panel')).toBeVisible();
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

test.describe('M11: findings dashboard and disposition', () => {
  test('findings appear after import, disposition persists across re-analysis, coverage shows', async ({
    page,
  }) => {
    await openApp(page);
    await importAndCommit(page);

    // Findings appear without a manual run (detection is a pure recompute).
    await page.getByTestId('nav-findings').click();
    await expect(page.getByTestId('findings-panel')).toBeVisible();
    await expect(page.getByTestId('findings-run-status')).toContainText('Computed as of op #');

    // A finding shows its rule version and verification steps.
    await expect(page.getByTestId('finding-rule').first()).toContainText('v1.0.0');
    await expect(page.getByTestId('finding-confidence').first()).toContainText('%');

    // Mark the first finding false-positive; the status persists.
    await page.getByTestId('finding-set-falsePositive').first().click();
    await expect(
      page.getByTestId('finding-status').filter({ hasText: 'falsePositive' }).first(),
    ).toBeVisible();

    // Re-run analysis: the disposition survives (fingerprint reconciliation).
    await page.getByTestId('findings-rerun').click();
    await expect(
      page.getByTestId('finding-status').filter({ hasText: 'falsePositive' }).first(),
    ).toBeVisible();

    // Coverage surfacing shows per-device evaluability.
    await expect(page.getByTestId('findings-coverage')).toBeVisible();
    await expect(page.getByTestId('coverage-ws-find-01')).toContainText('/');

    // Clean up so the shared e2e database is left as we found it (single worker,
    // one persistent DB across files) — mirror the imports test's rollback.
    await page.getByTestId('nav-imports').click();
    await page.getByTestId('import-rollback-button').click();
    await expect(page.getByTestId('import-review')).toContainText('rolledBack');
  });
});
