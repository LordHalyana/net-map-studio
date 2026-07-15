import { test, expect } from '@playwright/test';

test('app loads and renders the root element', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByText('NetPlan Studio')).toBeVisible();
});
