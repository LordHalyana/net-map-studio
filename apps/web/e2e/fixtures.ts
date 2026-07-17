import { test as base, expect } from '@playwright/test';
import { wipeAllProjects } from './global-setup';

export { expect };
export type { Page } from '@playwright/test';

/**
 * Every suite shares one API server + SQLite database (workers: 1), so a
 * suite that fails midway can poison the files after it (#92). Start every
 * test from an empty store instead: wipe all projects and let the app
 * bootstrap a fresh project on load.
 */
export const test = base.extend<{ emptyStore: void }>({
  emptyStore: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await wipeAllProjects();
      await use();
    },
    { auto: true },
  ],
});
