import { test, expect, type Page } from '@playwright/test';

/**
 * Improvements M13 (#70): secrets masking + audited reveal on the Settings
 * page; the default report excludes the secret.
 */

const FAKE_KEY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Q',
  '-----END RSA PRIVATE KEY-----',
].join('\\n');

const REPORT = JSON.stringify({
  schemaVersion: '1.0.0',
  hosts: [
    {
      deviceId: 'guid-web-secret-e2e',
      hostname: `web-sec ${FAKE_KEY}`,
      os: { name: 'Linux' },
      collectedAt: '2026-07-15T00:00:00.000Z',
      interfaces: [{ name: 'eth0', addresses: [{ value: '10.13.0.7', kind: 'ipv4' }] }],
      routes: [],
      arp: [],
      connections: [],
      listeningPorts: [],
      localUsers: [],
      localGroups: [],
      administrators: [],
      sudoers: [],
      collection: { scope: ['interfaces'], errors: [] },
    },
  ],
});

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

test.describe('Privacy & audit (improvements M13, #70)', () => {
  test('a private key imports masked, reveals audited, and stays out of the report', async ({
    page,
  }) => {
    await openApp(page);

    await page.getByTestId('nav-imports').click();
    await page.getByTestId('import-adapter-select').selectOption('device-state');
    await page.getByTestId('import-evidence-file-input').setInputFiles({
      name: 'secret.json',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(REPORT, 'utf8'),
    });
    await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('import-commit-button').click();
    await expect(page.getByTestId('import-review')).toContainText('committed');

    // Settings shows the masked secret
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-secrets')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('settings-secrets')).toContainText('[redacted]');
    await expect(page.getByTestId('settings-secrets')).not.toContainText('MIIBOgIBAAJBAKj');

    // reveal (audited) the private-key row specifically — the shared DB may
    // hold other secrets from earlier suites
    const keyRow = page
      .locator('[data-testid="settings-secrets"] tbody tr')
      .filter({ hasText: 'PEM private key' })
      .first();
    await keyRow.getByRole('button', { name: /Reveal/ }).click();
    await expect(keyRow).toContainText('MIIBOgIBAAJBAKj', { timeout: 10_000 });

    // the default design report never carries the key
    const [project] = await (await page.request.get('/api/projects')).json();
    const report = await page.request.get(`/api/projects/${project.id}/report`);
    expect(await report.text()).not.toContain('MIIBOgIBAAJBAKj');

    // clean up the shared DB: roll the import back
    await page.getByTestId('nav-imports').click();
    await page.getByTestId('import-job-device-state-committed').click();
    await page.getByTestId('import-rollback-button').click();
    await expect(page.getByTestId('import-review')).toContainText('rolledBack');
  });
});
