import { test, expect } from "@playwright/test";

test("authenticated user sees the app", async ({ page }) => {
  await page.goto("/");
  // Should not be redirected to login
  await expect(page).not.toHaveURL(/\/login/);
});

test("sidebar is visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation")).toBeVisible();
});
