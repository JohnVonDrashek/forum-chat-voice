import { expect, test } from '@playwright/test';

test('login page loads', async ({ page }) => {
  await page.goto('https://app.forumline.net/login');
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
});
