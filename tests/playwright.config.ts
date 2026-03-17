import { defineConfig, devices } from '@playwright/test';

const BASE_URLS = {
  app: 'https://app.forumline.net',
  hosted: 'https://hosted.forumline.net',
  website: 'https://forumline.net',
};

export default defineConfig({
  testDir: '.',
  testMatch: ['smoke/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'on-failure' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // --- Auth setup (runs first) ---
    {
      name: 'auth-setup',
      testMatch: 'fixtures/auth.setup.ts',
    },

    // --- Smoke tests (fast, critical path) ---
    {
      name: 'smoke',
      testMatch: 'smoke/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    // --- E2E: Forumline App ---
    {
      name: 'app',
      testMatch: 'e2e/app/**/*.spec.ts',
      dependencies: ['auth-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URLS.app,
        storageState: 'auth/testcaller.json',
      },
    },

    // --- E2E: Hosted ---
    {
      name: 'hosted',
      testMatch: 'e2e/hosted/**/*.spec.ts',
      dependencies: ['auth-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URLS.hosted,
        storageState: 'auth/testcaller.json',
      },
    },

    // --- E2E: Website ---
    {
      name: 'website',
      testMatch: 'e2e/website/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URLS.website,
      },
    },
  ],
});
