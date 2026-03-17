import { test as base, type Page } from '@playwright/test';

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
      storageState: 'auth/testcaller.json',
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  testuser_debugPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: 'auth/testuser_debug.json',
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
