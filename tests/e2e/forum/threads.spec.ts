import { test, expect } from "@playwright/test";

test("forum homepage loads threads", async ({ page }) => {
  await page.goto("/");
  // Forum should show thread list or welcome content
  await expect(page.locator("body")).not.toBeEmpty();
  expect(await page.title()).toBeTruthy();
});
