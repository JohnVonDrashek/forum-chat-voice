import { test, expect } from "@playwright/test";

test("login page loads", async ({ page }) => {
  await page.goto("https://app.forumline.net/login");
  await expect(page.locator("#loginEmail")).toBeVisible();
  await expect(page.locator("#loginPassword")).toBeVisible();
});
