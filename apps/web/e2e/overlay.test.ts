import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * M9/M10 DoD (plan §2): AS-IS hides planned-only objects; modifications are
 * field-deltas on the same UUID in the Diff; identities stay off the canvas
 * until the overlay is on; one domain principal spans hosts.
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

async function importAndCommitSample(page: Page) {
  await page.getByTestId('nav-imports').click();
  await page.getByTestId('import-adapter-select').selectOption('device-state');
  await page.getByTestId('import-evidence-file-input').setInputFiles({
    name: 'report.json',
    mimeType: 'application/json',
    buffer: Buffer.from(SAMPLE_REPORT, 'utf8'),
  });
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('import-commit-button').click();
  await expect(page.getByTestId('import-review')).toContainText('committed');
  await page.getByTestId('nav-canvas').click();
}

async function rollbackSample(page: Page) {
  await page.getByTestId('nav-imports').click();
  await page.getByTestId('import-job-device-state-committed').click();
  await page.getByTestId('import-rollback-button').click();
  await expect(page.getByTestId('import-review')).toContainText('rolledBack');
}

test.describe('M9: AS-IS / TO-BE / Diff overlay (ADR-0009)', () => {
  test('planned objects hide in AS-IS; modifications render as field-deltas on the same object', async ({
    page,
  }) => {
    await openApp(page);
    await importAndCommitSample(page);

    // author a TO-BE addition: manually drawn objects are born Planned
    await page.getByTestId('library-item-firewall').click();
    const planned = page.locator('.device-node__lifecycle--planned');
    await expect(planned.first()).toBeVisible();
    const plannedCount = await planned.count();

    // AS-IS hides planned-only objects, keeps the Observed import
    await page.getByTestId('mode-asIs').click();
    await expect(page.locator('.device-node__lifecycle--planned')).toHaveCount(0);
    await expect(page.getByTestId('device-node-web01')).toBeVisible();

    // TO-BE shows them again
    await page.getByTestId('mode-toBe').click();
    await expect(page.locator('.device-node__lifecycle--planned')).toHaveCount(plannedCount);

    // a TO-BE modification on an existing Observed object: same UUID, no duplicate
    await page.getByTestId('device-node-web01').click();
    await page.getByTestId('device-os-input').fill('Ubuntu Server 26.04');
    await page.getByTestId('device-os-input').press('Enter');
    await expect(page.getByTestId('sync-status')).toHaveText('Saved');
    await expect(page.getByTestId('device-node-web01')).toHaveCount(1);

    // the Diff lists it as a field-delta with before/after
    await page.getByTestId('mode-diff').click();
    await page.getByTestId('context-tab-diff').click();
    const modifications = page.getByTestId('diff-modifications');
    await expect(modifications).toContainText('web01.os');
    await expect(modifications).toContainText('Ubuntu Server 24.04');
    await expect(modifications).toContainText('Ubuntu Server 26.04');
    // additions list carries the planned firewall
    await expect(page.getByTestId('diff-additions')).toContainText('firewall');

    // remove-in-proposal flags without deleting; diff mode ghosts it
    await page.getByTestId('device-node-db01').click();
    await page.getByTestId('remove-in-proposal').click();
    await expect(page.getByTestId('diff-removals')).toContainText('db01');
    await expect(page.getByTestId('device-node-db01')).toBeVisible();

    // cleanup: restore flag, revert os, remove the planned firewall, roll back
    await page.getByTestId('restore-in-proposal').click();
    await page.getByTestId('mode-toBe').click();
    await page.getByTestId('device-node-web01').click();
    await page.getByTestId('device-os-input').fill('Ubuntu Server 24.04');
    await page.getByTestId('device-os-input').press('Enter');
    // other suite files may have left overlapping nodes — force the selection click
    const firewall = page
      .locator('.device-node', { has: page.locator('.device-node__lifecycle--planned') })
      .last();
    await firewall.click({ force: true });
    await page.getByTestId('delete-device').click();
    await expect(page.getByTestId('sync-status')).toHaveText('Saved');
    await rollbackSample(page);
  });
});

test.describe('M10: identity overlay & Users and Roles (ADR-0022)', () => {
  test('identities stay off the canvas until the overlay is on; one domain principal spans hosts', async ({
    page,
  }) => {
    await openApp(page);
    await importAndCommitSample(page);

    // hidden from the main canvas by default (§3.9)
    await expect(page.getByTestId('device-identities')).toHaveCount(0);

    // overlay on: principal chips appear on their hosts
    await page.getByTestId('toggle-identity-overlay').click();
    await expect(page.getByTestId('device-identities').first()).toBeVisible();
    const web01Chips = page.getByTestId('device-node-web01').getByTestId('device-identities');
    await expect(web01Chips).toContainText('ubuntu');
    await expect(web01Chips).toContainText('CORP\\alice');

    // Users and Roles: one domain-scoped alice with role assignments on two hosts
    await page.getByTestId('nav-identities').click();
    await expect(page.getByTestId('identities-panel')).toBeVisible();
    const aliceRows = page.getByTestId('identity-row-domain-alice');
    await expect(aliceRows).toHaveCount(1);
    const assignments = aliceRows.getByTestId('identity-assignments');
    await expect(assignments).toContainText('sudoer @ web01');
    await expect(assignments).toContainText('localAdministrator @ WS-FINANCE-07');
    // local users stay per-host
    await expect(page.getByTestId('identity-row-local-ubuntu')).toHaveCount(1);
    await expect(page.getByTestId('identity-row-local-postgres')).toHaveCount(1);

    // selecting a principal opens the identity inspector
    await aliceRows.click();
    await expect(page.getByTestId('identity-inspector')).toBeVisible();
    await expect(page.getByTestId('identity-scope')).toHaveText('domain');
    await expect(page.getByTestId('identity-inspector-assignments')).toContainText(
      'localAdministrator',
    );

    // cleanup
    await page.getByTestId('toggle-identity-overlay').click();
    await rollbackSample(page);
  });
});
