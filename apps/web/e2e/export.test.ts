import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

async function currentProject(page: Page): Promise<{ id: string; name: string }> {
  const [project] = await (await page.request.get('/api/projects')).json();
  return project;
}

test.describe('export & restore (M10 DoD, ADR-0016, acceptance #9/#10)', () => {
  test('exports a .netplan bundle that restores identically after deletion', async ({ page }) => {
    await openApp(page);

    // make sure there is something to export
    await page.getByTestId('library-item-router').click();
    await waitSaved(page);
    const project = await currentProject(page);
    const graphBefore = JSON.stringify(
      await (await page.request.get(`/api/projects/${project.id}/graph`)).json(),
    );

    // download the bundle
    await page.getByTestId('export-menu-toggle').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-netplan').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.netplan$/);
    const bundlePath = await download.path();
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
    expect(bundle.format).toBe('netplan');
    expect(bundle.project.project.id).toBe(project.id);

    // wipe the project, then restore from the bundle through the UI
    await page.request.delete(`/api/projects/${project.id}`);
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();

    await page.getByTestId('export-menu-toggle').click();
    await page.getByTestId('import-netplan').click();
    await page.getByTestId('import-file-input').setInputFiles(bundlePath);

    // wait until the imported project answers again, then compare
    await expect
      .poll(async () => (await page.request.get(`/api/projects/${project.id}/graph`)).status())
      .toBe(200);
    const graphAfter = JSON.stringify(
      await (await page.request.get(`/api/projects/${project.id}/graph`)).json(),
    );
    expect(graphAfter).toBe(graphBefore);
    // and the UI switched to it
    await expect(page.getByTestId('project-name')).toHaveText(project.name);
  });

  test('exports a valid PNG topology image', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('export-menu-toggle').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-png').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('topology.png');
    const buffer = fs.readFileSync(await download.path());
    // PNG magic bytes
    expect(buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  test('exports a valid SVG topology image', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('export-menu-toggle').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-svg').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('topology.svg');
    const svg = fs.readFileSync(await download.path(), 'utf8');
    expect(svg).toContain('<svg');
  });

  test('exports devices as CSV', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('library-item-switch').click();
    await waitSaved(page);

    await page.getByTestId('export-menu-toggle').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-csv-devices').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('devices.csv');
    const csv = fs.readFileSync(await download.path(), 'utf8');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('name');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
