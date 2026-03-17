import path from 'node:path';
import { test as base, type Page } from '@playwright/test';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

type TestFixtures = {
  testcallerPage: Page;
  testuser_debugPage: Page;
};

/**
 * Extends Playwright test with fixtures for both test users.
 * Useful for two-user scenarios (DMs, calls, etc).
 */
export const test = base.extend<TestFixtures>({
  testcallerPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: path.join(__dirname, '../auth/testcaller.json'),
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  testuser_debugPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: path.join(__dirname, '../auth/testuser_debug.json'),
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
