import { test as setup, expect } from "@playwright/test";

const APP_URL = "https://app.forumline.net";

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
 *   - TESTCALLER_PASSWORD (from macOS Keychain via run-local.sh)
 *   - TESTUSER_DEBUG_PASSWORD (from macOS Keychain via run-local.sh)
 *
 * TODO: Create dedicated test users in Zitadel. The old test users
 * (testcaller@example.com, testavatar2@example.com) don't exist in the
 * current Zitadel instance. For now, use your real account or create
 * test users via the Zitadel admin console at auth.forumline.net.
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
    await page.getByRole("link", { name: /sign in/i }).click();

    // Zitadel login form
    await page.waitForURL(/auth\.forumline\.net/);
    await page.getByRole("textbox", { name: "Login Name" }).fill(email);
    await page.getByRole("button", { name: "Next" }).click();

    // Password page
    await page.waitForURL(/\/password|\/loginname/);
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("button", { name: "Next" }).click();

    // Wait for redirect back to the app
    await expect(page).toHaveURL(new RegExp(APP_URL.replace(/\./g, "\\.")));

    await page.context().storageState({ path: statePath });
  });
}

void loginAndSave(
  setup,
  process.env.TESTCALLER_EMAIL ?? "testcaller@example.com",
  process.env.TESTCALLER_PASSWORD!,
  "auth/testcaller.json",
);

void loginAndSave(
  setup,
  process.env.TESTUSER_DEBUG_EMAIL ?? "testavatar2@example.com",
  process.env.TESTUSER_DEBUG_PASSWORD!,
  "auth/testuser_debug.json",
);
