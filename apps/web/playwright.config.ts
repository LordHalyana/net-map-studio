import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eDbFile = path.join(here, 'e2e', '.e2e-data', 'netplan-e2e.db');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // All tests share one server + database; parallel workers would interfere.
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
  webServer: [
    {
      command: 'pnpm --filter @netplan/server dev',
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NETPLAN_DB: e2eDbFile },
    },
    {
      command: 'pnpm dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
