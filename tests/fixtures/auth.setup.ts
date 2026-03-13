import { test as setup, expect } from "@playwright/test";

const APP_URL = "https://app.forumline.net";

/**
 * Logs in a test user and saves the authenticated browser state.
 * Credentials come from env vars (locally: source from macOS Keychain).
 */
async function loginAndSave(
  browser: typeof setup,
  email: string,
  password: string,
  statePath: string,
) {
  browser(`authenticate ${email}`, async ({ page }) => {
    await page.goto(`${APP_URL}/login`);
    await page.locator("#loginEmail").fill(email);
    await page.locator("#loginPassword").fill(password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // Wait for redirect to the app after login
    await expect(page).not.toHaveURL(/\/login/);

    await page.context().storageState({ path: statePath });
  });
}

loginAndSave(
  setup,
  "testcaller@example.com",
  process.env.TESTCALLER_PASSWORD!,
  "auth/testcaller.json",
);

loginAndSave(
  setup,
  "testavatar2@example.com",
  process.env.TESTUSER_DEBUG_PASSWORD!,
  "auth/testuser_debug.json",
);
