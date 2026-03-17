import { expect, test } from '../../fixtures/test-users.js';

test('both users can open DM conversation', async ({ testcallerPage, testuser_debugPage }) => {
  const dmUrl = 'https://app.forumline.net/dm/17eefb2d-c5f0-4c04-bf65-e5233a1592d8';

  await testcallerPage.goto(dmUrl);
  await testuser_debugPage.goto(dmUrl);

  // Both users should see the message input
  await expect(testcallerPage.getByPlaceholder(/message/i)).toBeVisible();
  await expect(testuser_debugPage.getByPlaceholder(/message/i)).toBeVisible();
});
