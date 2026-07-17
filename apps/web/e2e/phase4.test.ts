import { test, expect, type Page } from './fixtures';

/**
 * P4-M7 smoke coverage: the egress door settings + disclosure gate, the
 * zero-egress local-feed enrichment path with the audit view, the new import
 * adapters, and the proposal sign-off control (M6).
 */

const UNMATCHED_HASH = 'ef'.repeat(32);

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function openEgress(page: Page) {
  await page.getByTestId('nav-egress').click();
  await expect(page.getByTestId('egress-panel')).toBeVisible();
}

test.describe('P4: egress door & threat intel', () => {
  test('door starts shut; enabling requires the disclosure; local feed enriches with zero egress', async ({
    page,
  }) => {
    await openApp(page);
    await openEgress(page);

    // shut by default
    await expect(page.getByTestId('egress-status')).toContainText('shut');
    await expect(page.getByTestId('egress-disclosure')).toContainText('audit');

    // enabling without acknowledging the disclosure is refused
    await page.getByTestId('egress-enable').check();
    await page.getByTestId('egress-save').click();
    await expect(page.getByTestId('egress-error')).toContainText(/disclosure/i);
    await expect(page.getByTestId('egress-status')).toContainText('shut');

    // the zero-egress path: feed an indicator, look it up offline
    await page.getByTestId('feed-indicator').fill(UNMATCHED_HASH);
    await page.getByTestId('feed-add').click();
    await expect(page.getByTestId('feed-entries')).toContainText(UNMATCHED_HASH.slice(0, 16));

    await page.getByTestId('lookup-query').fill(UNMATCHED_HASH);
    await page.getByTestId('lookup-run').click();
    await expect(page.getByTestId('enrichment-list')).toBeVisible();
    const row = page.getByTestId('enrichment-row').first();
    await expect(row).toContainText('malicious');
    await expect(row).toContainText('local-feed');
    await expect(row).toContainText('fresh');

    // zero egress: the outbound audit trail stayed empty
    await expect(page.getByTestId('egress-audit-empty')).toBeVisible();

    // removing the indicator empties the feed again
    await page.getByTestId('feed-remove').first().click();
    await expect(page.getByTestId('local-feed')).toContainText('No indicators');
  });

  test('post-disclosure, a stub call is audited; the door can be shut again', async ({ page }) => {
    await openApp(page);
    await openEgress(page);

    await page.getByTestId('egress-enable').check();
    await page.getByTestId('egress-acknowledge').check();
    await page.getByTestId('egress-save').click();
    await expect(page.getByTestId('egress-status')).toContainText('open');

    await page.getByTestId('lookup-provider').selectOption('stub');
    await page.getByTestId('lookup-query').fill(UNMATCHED_HASH);
    await page.getByTestId('lookup-run').click();

    const audit = page.getByTestId('egress-audit-row');
    await expect(audit.first()).toContainText('stub');
    await expect(audit.first()).toContainText('success');

    // shut the door again (no acknowledgment needed to narrow)
    await page.getByTestId('egress-enable').uncheck();
    await page.getByTestId('egress-save').click();
    await expect(page.getByTestId('egress-status')).toContainText('shut');
  });
});

test.describe('P4: import adapters & proposal sign-off', () => {
  test('the wizard offers the LDIF and Zeek adapters', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('nav-imports').click();
    const options = page.getByTestId('import-adapter-select').locator('option');
    await expect(options.filter({ hasText: 'LDIF' })).toHaveCount(1);
    await expect(options.filter({ hasText: 'Zeek' })).toHaveCount(1);
  });

  test('a proposal moves draft → proposed → approved through the sign-off control', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId('context-tab-diff').click();
    await expect(page.getByTestId('proposal-signoff')).toBeVisible();

    await page.getByTestId('proposal-label').fill('e2e sign-off proposal');
    await page.getByTestId('proposal-register').click();
    await expect(page.getByTestId('proposal-draft')).toContainText('e2e sign-off proposal');

    await page.getByTestId('proposal-set-proposed').click();
    await expect(page.getByTestId('proposal-proposed')).toBeVisible();

    await page.getByTestId('proposal-set-approved').click();
    await expect(page.getByTestId('proposal-approved')).toBeVisible();

    // the transitions are Operations: they appear in the activity log
    await page.getByTestId('context-tab-activity').click();
    await expect(page.getByText('Set proposal review status to approved').first()).toBeVisible();
  });
});
