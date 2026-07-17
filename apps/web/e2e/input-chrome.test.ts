import type { Locator } from '@playwright/test';
import { test, expect, type Page } from './fixtures';

/**
 * Regression guard for issue #100. Text inputs get their chrome from one
 * shared base rule (`:where(input[type='text'], …)` in styles.css) instead of
 * per-group copies. This bug shipped twice before that base existed: an input
 * group that set only layout silently fell back to browser-default chrome
 * (grey fill, 2px inset border, square corners) against the dark theme.
 *
 * The sweep covers inputs across views that now rely entirely on the base for
 * their chrome — including the egress feed + lookup fields that #100 was
 * actually filed about — plus the transparent library search that must keep
 * overriding the base (`:where()` gives it zero specificity, so the scoped
 * rule wins; a normal-specificity base placed after it would regress it).
 */

const THEMED_BG = 'rgb(11, 14, 19)'; // --bg  #0b0e13
const THEMED_BORDER = 'rgb(36, 44, 57)'; // --border  #242c39

// Themed chrome from the base rule — not the browser default (grey fill,
// 2px inset border, square corners) the two egress fields once rendered.
const THEMED_CHROME = {
  backgroundColor: THEMED_BG,
  borderTopWidth: '1px',
  borderTopStyle: 'solid',
  borderTopColor: THEMED_BORDER,
  borderRadius: '4px', // --radius-xs
};

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function openEgress(page: Page) {
  await page.getByTestId('nav-egress').click();
  await expect(page.getByTestId('egress-panel')).toBeVisible();
}

function readChrome(input: Locator) {
  return input.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      backgroundColor: s.backgroundColor,
      borderTopWidth: s.borderTopWidth,
      borderTopStyle: s.borderTopStyle,
      borderTopColor: s.borderTopColor,
      borderRadius: s.borderTopLeftRadius,
    };
  });
}

test.describe('text-input chrome (issue #100)', () => {
  test('the global search input inherits the themed base chrome', async ({ page }) => {
    await openApp(page);

    const input = page.getByTestId('global-search-input');
    await expect(input).toBeVisible();

    expect(await readChrome(input)).toEqual(THEMED_CHROME);
  });

  test('the egress feed + lookup fields (#100 repro) report themed chrome, not browser default', async ({
    page,
  }) => {
    await openApp(page);
    await openEgress(page);

    for (const testId of ['feed-indicator', 'lookup-query']) {
      const input = page.getByTestId(testId);
      await expect(input).toBeVisible();
      expect(await readChrome(input), `${testId} chrome`).toEqual(THEMED_CHROME);
    }
  });

  test('a deliberate transparent input still overrides the base rule', async ({ page }) => {
    await openApp(page);

    const input = page.getByTestId('library-search');
    await expect(input).toBeVisible();

    const chrome = await input.evaluate((el) => {
      const s = getComputedStyle(el);
      return { backgroundColor: s.backgroundColor, borderTopStyle: s.borderTopStyle };
    });

    // `.library-search input { background: transparent; border: none }` must win.
    expect(chrome.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(chrome.borderTopStyle).toBe('none');
  });
});
