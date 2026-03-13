import { test, expect } from "@playwright/test";

test("landing page has key content", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toContainText(/forumline/i);
});
