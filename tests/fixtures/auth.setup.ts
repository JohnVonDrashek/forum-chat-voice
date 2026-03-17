import path from 'node:path';
import { expect, test as setup } from '@playwright/test';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const APP_URL = 'https://app.forumline.net';

/**
 * Logs in a test user via Zitadel OIDC and saves the authenticated browser state.
 *
 * The login flow is:
 *   1. Navigate to app login page
 *   2. Click "Sign in" which redirects to Zitadel (auth.forumline.net)
 *   3. Enter username and password on Zitadel login form
 *   4. Zitadel redirects back to app with tokens
 *   5. Save browser state (cookies, localStorage) for reuse in tests
 *
 * Credentials come from env vars:
 *   - TESTCALLER_PASSWORD (from secrets.kdbx via run-local.sh)
 *   - TESTUSER_DEBUG_PASSWORD (from secrets.kdbx via run-local.sh)
 *
 * Test users created in Zitadel via API:
 *   - testcaller (testcaller@forumline.net, ID: 364424139072602115)
 *   - testuser_debug (testuser_debug@forumline.net, ID: 364424151923949571)
 */
async function loginAndSave(
  browser: typeof setup,
  email: string,
  password: string,
  statePath: string,
) {
  browser(`authenticate ${email}`, async ({ page }) => {
    await page.goto(`${APP_URL}/login`);

    // Click the sign-in button to start Zitadel OIDC flow
    await page.getByRole('button', { name: /sign in/i }).click();

    // Zitadel login form
    await page.waitForURL(/auth\.forumline\.net/);
    await page.getByRole('textbox', { name: 'Login Name' }).fill(email);
    await page.getByRole('button', { name: 'Next' }).click();

    // Password page
    await page.waitForURL(/\/password|\/loginname/);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Next' }).click();

    // Wait for redirect back to the app
    await expect(page).toHaveURL(new RegExp(APP_URL.replace(/\./g, '\\.')));

    await page.context().storageState({ path: statePath });
  });
}

void loginAndSave(
  setup,
  process.env.TESTCALLER_EMAIL ?? 'testcaller@forumline.net',
  process.env.TESTCALLER_PASSWORD!,
  path.join(__dirname, '../auth/testcaller.json'),
);

void loginAndSave(
  setup,
  process.env.TESTUSER_DEBUG_EMAIL ?? 'testuser_debug@forumline.net',
  process.env.TESTUSER_DEBUG_PASSWORD!,
  path.join(__dirname, '../auth/testuser_debug.json'),
);
