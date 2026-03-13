import { test, expect } from "@playwright/test";

const sites = [
  { name: "Forumline App", url: "https://app.forumline.net" },
  { name: "Demo Forum", url: "https://demo.forumline.net" },
  { name: "Hosted", url: "https://hosted.forumline.net" },
  { name: "Website", url: "https://forumline.net" },
];

for (const site of sites) {
  test(`${site.name} is reachable`, async ({ page }) => {
    const response = await page.goto(site.url);
    expect(response?.status()).toBeLessThan(500);
  });
}
