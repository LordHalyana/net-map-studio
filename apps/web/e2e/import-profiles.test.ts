import { test, expect, type Page } from './fixtures';
import { IMPORT_FORMAT_SPECS } from '@netplan/domain';

/**
 * #90 A4 DoD: the ImportProfile authoring UI unlocks the profile-driven
 * netcat-text adapter — create a profile (live tester previewing captured
 * groups), see the adapter join the wizard dropdown, and import a netcat log
 * through it. Jobs stay in review (nothing committed); the shared DB is wiped
 * per test by the fixture.
 */

const NETCAT_SPEC = IMPORT_FORMAT_SPECS['netcat-text'];

async function openImports(page: Page) {
  await page.goto('/');
  await page.getByTestId('nav-imports').click();
  await expect(page.getByTestId('imports-panel')).toBeVisible();
}

const adapterOption = (page: Page) =>
  page.getByTestId('import-adapter-select').locator('option[value="netcat-text"]');

test.describe('A4: import profile authoring', () => {
  test('creating a profile unlocks netcat-text and imports through it', async ({ page }) => {
    await openImports(page);

    // without a profile the adapter stays out of the wizard
    await expect(adapterOption(page)).toHaveCount(0);

    // author a profile — the editor prefills the descriptor's tested pattern,
    // and the live tester previews its captured groups over the example lines
    await page.getByTestId('import-profiles').locator('summary').click();
    await page.getByTestId('profile-new').click();
    const preview = page.getByTestId('profile-preview');
    await expect(preview.getByTestId('profile-preview-line')).toHaveCount(3);
    await expect(preview.getByTestId('profile-preview-line').first()).toContainText(
      'host=10.0.10.21',
    );
    // the nc-refused line does not match the example pattern
    await expect(preview.getByTestId('profile-preview-line').last()).toContainText('no match');

    await page.getByTestId('profile-name-input').fill('nc sweep');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-row-nc sweep')).toBeVisible();

    // the adapter joined the dropdown; selecting it shows the profile select
    await expect(adapterOption(page)).toHaveCount(1);
    await page.getByTestId('import-adapter-select').selectOption('netcat-text');
    await expect(page.getByTestId('import-profile-select')).toHaveValue(/.+/);

    // a netcat log imports through the profile into service claims
    await page.getByTestId('import-evidence-file-input').setInputFiles({
      name: 'sweep.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(NETCAT_SPEC?.example ?? '', 'utf8'),
    });
    await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('import-review')).toContainText('netcat-text');
    await expect(page.getByTestId('import-candidates')).toContainText('10.0.10.21');
  });

  test('an invalid pattern is blocked inline; deleting the profile re-locks the adapter', async ({
    page,
  }) => {
    await openImports(page);
    await page.getByTestId('import-profiles').locator('summary').click();
    await page.getByTestId('profile-new').click();

    // validation is inline (B6 conventions): bad regex → error, no profile
    await page.getByTestId('profile-name-input').fill('broken');
    await page.getByTestId('profile-pattern-input').fill('(?<host>[');
    await expect(page.getByTestId('profile-preview-error')).toBeVisible();
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-error')).toContainText('regular expression');
    await expect(page.getByTestId('profile-row-broken')).toHaveCount(0);

    // fix the pattern, save, edit the name, then delete — adapter re-locks
    await page.getByTestId('profile-pattern-input').fill(NETCAT_SPEC?.exampleProfilePattern ?? '');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-row-broken')).toBeVisible();
    await expect(adapterOption(page)).toHaveCount(1);

    await page.getByTestId('profile-edit-broken').click();
    await page.getByTestId('profile-name-input').fill('fixed');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-row-fixed')).toBeVisible();

    await page.getByTestId('profile-delete-fixed').click();
    await expect(page.getByTestId('profile-row-fixed')).toHaveCount(0);
    await expect(adapterOption(page)).toHaveCount(0);
  });
});
