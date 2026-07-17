import { test, expect, type Page } from './fixtures';
import { IMPORT_FORMAT_SPECS, wizardImportFormats } from '@netplan/domain';

/**
 * #90 A1 DoD: every adapter in the wizard dropdown shows its full expected
 * structure in-app — field table, minimal example, notes — all driven by the
 * shared ImportFormatSpec descriptors, so the assertion is literally "the UI
 * matches the descriptor". Creates no entities; nothing to clean up.
 */

test.describe('A1: expected-format helper panel', () => {
  test('each wizard adapter documents its fields, example and notes', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-imports').click();
    await expect(page.getByTestId('imports-panel')).toBeVisible();

    for (const spec of wizardImportFormats()) {
      await page.getByTestId('import-adapter-select').selectOption(spec.adapter);
      const help = page.getByTestId('import-format-help');
      await expect(help).toBeVisible();

      // collapsed by default — first visit to this adapter expands it
      await expect(help.getByTestId('import-format-fields')).toBeHidden();
      await help.locator('summary').click();

      const rows = help.getByTestId('import-format-field');
      await expect(rows).toHaveCount(spec.fields.length);
      const names = await rows.locator('td:first-child').allInnerTexts();
      expect(names).toEqual(spec.fields.map((field) => field.name));

      await expect(help.getByTestId('import-format-example')).toContainText(
        (spec.example.split('\n')[0] ?? '').trim(),
      );
      await expect(help.locator('.format-help__notes li')).toHaveCount(spec.notes.length);
      await expect(help.getByTestId('import-format-copy')).toBeVisible();
    }

    // expansion is remembered per adapter: device-state was expanded above
    await page.getByTestId('import-adapter-select').selectOption('device-state');
    await expect(
      page.getByTestId('import-format-help').getByTestId('import-format-fields'),
    ).toBeVisible();
  });

  /**
   * #95: expansion must be recorded against the adapter whose panel was
   * actually opened, however fast the operator then switches. Opening and
   * switching in one task pins the race the loop above only hits
   * intermittently; both halves matter, so both are asserted.
   *
   * `dispatchEvent` rather than `selectOption` because pinning the race needs
   * both actions in a single task, which the awaited locator API cannot
   * express. A synthetic `change` reaches React here only because it takes the
   * native change path for <select> — the same trick is silently swallowed by
   * an <input>'s value tracker.
   */
  test('a help panel opened as the adapter switches is recorded against the right adapter', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('nav-imports').click();
    await expect(page.getByTestId('imports-panel')).toBeVisible();

    await page.getByTestId('import-adapter-select').selectOption('nmap-xml');
    await expect(page.getByTestId('import-format-help')).toBeVisible();

    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="import-format-help"] summary')?.click();
      const select = document.querySelector<HTMLSelectElement>(
        '[data-testid="import-adapter-select"]',
      );
      if (!select) throw new Error('adapter select missing');
      select.value = 'tshark-flows';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.getByTestId('import-adapter-select')).toHaveValue('tshark-flows');
    // tshark-flows was never expanded, so it must arrive collapsed
    await expect(page.getByTestId('import-format-help')).toHaveJSProperty('open', false);

    // ...and nmap-xml, the panel actually opened, is still remembered (#90 A1)
    await page.getByTestId('import-adapter-select').selectOption('nmap-xml');
    await expect(page.getByTestId('import-format-help')).toHaveJSProperty('open', true);
  });

  // the panel toggles from a cancelled summary click (#95), so the keyboard
  // path the browser would otherwise give us for free is worth holding onto
  test('the help panel still toggles from the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-imports').click();
    await page.getByTestId('import-adapter-select').selectOption('nmap-xml');
    const help = page.getByTestId('import-format-help');
    await expect(help).toHaveJSProperty('open', false);

    await help.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(help).toHaveJSProperty('open', true);
    await page.keyboard.press('Space');
    await expect(help).toHaveJSProperty('open', false);
  });

  test('the minimal example downloads as a working starter file', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-imports').click();
    await page.getByTestId('import-adapter-select').selectOption('tshark-flows');
    const help = page.getByTestId('import-format-help');
    await help.locator('summary').click();

    const downloadPromise = page.waitForEvent('download');
    await help.getByTestId('import-format-download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('example.csv');
  });
});

/**
 * #90 A2 DoD: a malformed device-state report is fully diagnosed in-browser
 * before any upload; a valid report shows its host count; the JSON Schema
 * downloads. The invalid case creates no job, the valid case stays in
 * review (no entities committed) — nothing to clean up.
 */

async function chooseDeviceStateFile(page: Page, content: string) {
  await page.getByTestId('nav-imports').click();
  await expect(page.getByTestId('imports-panel')).toBeVisible();
  await page.getByTestId('import-adapter-select').selectOption('device-state');
  await page.getByTestId('import-evidence-file-input').setInputFiles({
    name: 'report.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content, 'utf8'),
  });
}

test.describe('A2: device-state pre-upload validation', () => {
  test('a malformed report is blocked in-browser with per-path issues', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-imports').click();
    const jobsBefore = await page.getByTestId('import-job-list').locator('li').count();

    await chooseDeviceStateFile(
      page,
      JSON.stringify({ schemaVersion: '1.0.0', hosts: [{ hostname: 'app-01' }] }),
    );

    const errors = page.getByTestId('import-validation-errors');
    await expect(errors).toBeVisible();
    await expect(errors).toContainText('upload blocked');
    await expect(errors).toContainText('hosts.0.deviceId');
    // blocked means blocked: no job was created
    expect(await page.getByTestId('import-job-list').locator('li').count()).toBe(jobsBefore);
  });

  test('a valid report shows its host count and uploads normally', async ({ page }) => {
    await page.goto('/');
    await chooseDeviceStateFile(page, IMPORT_FORMAT_SPECS['device-state']?.example ?? '');

    await expect(page.getByTestId('import-validation-ok')).toContainText('1 host, schema 1.0.0');
    await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 15_000 });
  });

  test('a bad-header tshark CSV is blocked pre-upload, naming the missing columns', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('nav-imports').click();
    const jobsBefore = await page.getByTestId('import-job-list').locator('li').count();

    await page.getByTestId('import-adapter-select').selectOption('tshark-flows');
    await page.getByTestId('import-evidence-file-input').setInputFiles({
      name: 'flows.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('src,dst\n10.0.0.1,10.0.0.2', 'utf8'),
    });

    const error = page.getByTestId('import-preflight-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('source and destination');
    expect(await page.getByTestId('import-job-list').locator('li').count()).toBe(jobsBefore);
  });

  test('the JSON Schema downloads from the device-state help panel', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-imports').click();
    await page.getByTestId('import-adapter-select').selectOption('device-state');
    const help = page.getByTestId('import-format-help');
    await help.locator('summary').click();

    const downloadPromise = page.waitForEvent('download');
    await help.getByTestId('import-format-schema-download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('device-state.schema.json');
  });
});
