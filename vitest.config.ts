import { defineConfig } from 'vitest/config';

/**
 * Root config exists for `pnpm test:coverage`: one vitest run across every
 * workspace project with a single merged coverage report (#110 A4). Regular
 * test runs stay per-package (`pnpm -r test`) — each package's own
 * vitest.config.ts is the source of truth for what it includes.
 */
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['**/src/**'],
    },
  },
});
