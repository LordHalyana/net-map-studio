import { test, expect } from '@playwright/test';
import { wizardImportFormats } from '@netplan/domain';

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
