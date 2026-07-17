import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from './fixtures';

/**
 * M7/M8 DoD (plan §2): import wizard → review → resolve → commit → Observed
 * objects on the canvas; rollback removes them cleanly; the queue never
 * auto-merges; every imported field traces to its Evidence; overrides are
 * undoable; confidence/evidence badges render.
 */

const SAMPLE_REPORT = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'packages',
    'import-contract',
    'test',
    'fixtures',
    'sample-report.json',
  ),
  'utf8',
);

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function uploadReport(page: Page, content: string, adapter = 'device-state') {
  await page.getByTestId('nav-imports').click();
  await expect(page.getByTestId('imports-panel')).toBeVisible();
  await page.getByTestId('import-adapter-select').selectOption(adapter);
  await page.getByTestId('import-evidence-file-input').setInputFiles({
    name: adapter === 'nmap-xml' ? 'scan.xml' : 'report.json',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(content, 'utf8'),
  });
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 15_000 });
}

async function rollbackSelected(page: Page) {
  await page.getByTestId('import-rollback-button').click();
  await expect(page.getByTestId('import-review')).toContainText('rolledBack');
}

test.describe('M7: import wizard, review, commit, rollback', () => {
  test('device-state import commits Observed devices and rolls back cleanly', async ({ page }) => {
    await openApp(page);
    await uploadReport(page, SAMPLE_REPORT);

    // review state: the proposal summarizes what it will create, no conflicts
    await expect(page.getByTestId('proposal-summary')).toContainText('device');
    await expect(page.getByTestId('conflicts-empty')).toBeVisible();
    // candidates show their §3.7 confidence
    await expect(page.getByTestId('candidate-confidence').first()).toContainText('%');
    // evidence is listed with its hash before commit
    await expect(page.getByTestId('evidence-hash').first()).toContainText('sha256');

    await page.getByTestId('import-commit-button').click();
    await expect(page.getByTestId('import-review')).toContainText('committed');

    // the imported hosts are on the canvas as Observed
    await page.getByTestId('nav-canvas').click();
    await expect(page.getByTestId('device-node-web01')).toBeVisible();
    await expect(page.getByTestId('device-node-db01')).toBeVisible();
    // badge strip reveals on hover (visual-parity M1 badge policy)
    await page.getByTestId('device-node-web01').hover();
    await expect(
      page.getByTestId('device-node-web01').locator('.device-node__lifecycle--observed'),
    ).toBeVisible();
    // M8: confidence + evidence-count badges render on imported nodes
    await expect(
      page.getByTestId('device-node-web01').getByTestId('badge-confidence'),
    ).toContainText('%');
    await expect(page.getByTestId('device-node-web01').getByTestId('badge-evidence')).toContainText(
      '⎘',
    );
    // M6: observed traffic renders as bundled flow edges (web01 → db01:5432)
    await expect(page.locator('.react-flow__edge', { hasText: 'tcp/5432' })).toHaveCount(1);

    // rollback removes them cleanly
    await page.getByTestId('nav-imports').click();
    await rollbackSelected(page);
    await page.getByTestId('nav-canvas').click();
    await expect(page.getByTestId('device-node-web01')).toHaveCount(0);
    await expect(page.getByTestId('device-node-db01')).toHaveCount(0);
  });

  test('an overlapping import raises a conflict; merge commits onto the existing object', async ({
    page,
  }) => {
    await openApp(page);
    await uploadReport(page, SAMPLE_REPORT);
    await page.getByTestId('import-commit-button').click();
    await expect(page.getByTestId('import-review')).toContainText('committed');

    // second, overlapping source: same host, conflicting name
    const NMAP = `<?xml version="1.0"?>
<nmaprun scanner="nmap" start="1783500000">
  <host endtime="1783500042">
    <status state="up"/>
    <address addr="10.0.0.10" addrtype="ipv4"/>
    <address addr="AA:BB:CC:00:00:01" addrtype="mac" vendor="Dell Inc."/>
    <hostnames><hostname name="web01.corp.example" type="PTR"/></hostnames>
  </host>
</nmaprun>`;
    await uploadReport(page, NMAP, 'nmap-xml');

    // the conflict is visible with its field diffs; commit is blocked
    const review = page.getByTestId('import-review');
    await expect(review.getByTestId('conflict-device')).toBeVisible();
    await expect(review.getByTestId('conflict-diffs')).toContainText('web01.corp.example');
    await expect(page.getByTestId('import-commit-button')).toBeDisabled();

    // the bottom context panel shows the reconciliation conflicts too (§3.2E)
    await expect(page.getByTestId('context-tab-conflicts')).toContainText('Conflicts (1)');
    await expect(page.getByTestId('context-panel').getByTestId('conflict-device')).toBeVisible();

    // merge, then commit: one web01, vendor gap-filled from the scan
    await review.getByTestId('resolve-merge').first().click();
    await expect(review.getByTestId('conflict-resolution').first()).toContainText('merge');
    await page.getByTestId('import-commit-button').click();
    await expect(page.getByTestId('import-review')).toContainText('committed');

    await page.getByTestId('nav-canvas').click();
    await expect(page.getByTestId('device-node-web01')).toHaveCount(1);
    await expect(page.getByTestId('device-node-web01.corp.example')).toHaveCount(0);

    // both imports unwind cleanly, latest first — a merged commit rolls back too
    await page.getByTestId('nav-imports').click();
    await page.getByTestId('import-job-nmap-xml-committed').click();
    await rollbackSelected(page);
    await page.getByTestId('import-job-device-state-committed').click();
    await rollbackSelected(page);
    await page.getByTestId('nav-canvas').click();
    await expect(page.getByTestId('device-node-web01')).toHaveCount(0);
  });
});

test.describe('M8: provenance surfacing (acceptance #6)', () => {
  test('every imported field traces to its evidence; override is undoable', async ({ page }) => {
    await openApp(page);
    await uploadReport(page, SAMPLE_REPORT);
    await page.getByTestId('import-commit-button').click();
    await expect(page.getByTestId('import-review')).toContainText('committed');

    // inspect an imported device: per-field provenance with evidence reference
    await page.getByTestId('nav-canvas').click();
    await page.getByTestId('device-node-db01').click();
    await expect(page.getByTestId('provenance-section')).toBeVisible();
    const osField = page.getByTestId('provenance-field-os');
    await expect(osField).toContainText('accepted');
    await expect(osField.getByTestId('provenance-evidence').first()).toContainText('report.json');

    // override the imported value: manual provenance row + undoable Operation
    await osField.getByTestId('override-os').click();
    await page.getByTestId('override-input').fill('Debian 13 (planned upgrade)');
    await page.getByTestId('override-submit').click();
    await expect(page.getByTestId('device-os-input')).toHaveValue('Debian 13 (planned upgrade)');
    await expect(osField.locator('.provenance-status--overridden').first()).toBeVisible();
    await expect(osField).toContainText('manual');

    // undo restores the imported value
    await page.getByTestId('undo-button').click();
    await expect(page.getByTestId('device-os-input')).toHaveValue('Debian 12');
  });
});
