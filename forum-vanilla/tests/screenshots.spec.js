import { test, expect } from '@playwright/test'

test.use({ screenshot: 'on' })

test('walkthrough - home page', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('text=Recent Discussions')).toBeVisible()
  await page.screenshot({ path: 'screenshots/01-home.png', fullPage: true })
})

test('walkthrough - login page', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('h1 >> text=Sign In')).toBeVisible()
  await page.screenshot({ path: 'screenshots/02-login.png' })
})

test('walkthrough - register page', async ({ page }) => {
  await page.goto('/register')
  await expect(page.locator('h1 >> text=Create Account')).toBeVisible()
  await page.screenshot({ path: 'screenshots/03-register.png' })
})

test('walkthrough - category page', async ({ page }) => {
  await page.goto('/c/general')
  await expect(page.locator('h1')).toContainText('General')
  await page.screenshot({ path: 'screenshots/04-category.png', fullPage: true })
})

test('walkthrough - search page', async ({ page }) => {
  await page.goto('/search')
  await expect(page.locator('#search-input')).toBeVisible()
  await page.screenshot({ path: 'screenshots/05-search.png' })
})

test('walkthrough - 404 page', async ({ page }) => {
  await page.goto('/nonexistent')
  await expect(page.locator('text=Page Not Found')).toBeVisible()
  await page.screenshot({ path: 'screenshots/06-404.png' })
})

test('walkthrough - register, create thread, view it', async ({ page }) => {
  const ts = Date.now()
  // Register
  await page.goto('/register')
  await page.fill('input[name="username"]', `screenshotuser${ts}`)
  await page.fill('input[name="email"]', `screenshotuser${ts}@example.com`)
  await page.fill('input[name="password"]', 'testpass123')
  await page.click('button[type="submit"]')
  await page.waitForURL('/')
  await expect(page.locator('text=Recent Discussions')).toBeVisible()
  await page.screenshot({ path: 'screenshots/07-logged-in-home.png', fullPage: true })

  // Settings
  await page.goto('/settings')
  await expect(page.locator('h1')).toBeVisible()
  await page.screenshot({ path: 'screenshots/08-settings.png' })

  // Bookmarks
  await page.goto('/bookmarks')
  await expect(page.locator('h1')).toBeVisible()
  await page.screenshot({ path: 'screenshots/09-bookmarks.png' })

  // Create thread
  await page.goto('/c/general')
  await page.click('text=New Thread')
  await expect(page.locator('h1')).toContainText('New Thread')
  await page.fill('input[name="title"]', `Screenshot Test Thread ${ts}`)
  await page.fill('textarea[name="content"]', 'This thread was created during the screenshot walkthrough.')
  await page.screenshot({ path: 'screenshots/10-new-thread.png' })

  await page.click('button[type="submit"]')
  await page.waitForURL(/\/t\//, { timeout: 10000 })
  await expect(page.locator('h1')).toContainText(`Screenshot Test Thread ${ts}`)
  await page.screenshot({ path: 'screenshots/11-thread-view.png', fullPage: true })

  // Home should now show the thread
  await page.goto('/')
  await expect(page.locator('text=Recent Discussions')).toBeVisible()
  await page.screenshot({ path: 'screenshots/12-home-with-thread.png', fullPage: true })

  // Chat
  await page.goto('/chat')
  await expect(page.locator('#page-content')).toBeVisible()
  await page.screenshot({ path: 'screenshots/13-chat.png' })

  // Voice
  await page.goto('/voice')
  await expect(page.locator('#page-content')).toBeVisible()
  await page.screenshot({ path: 'screenshots/14-voice.png' })

  // Profile
  await page.goto(`/u/screenshotuser${ts}`)
  await expect(page.locator('h1')).toBeVisible()
  await page.screenshot({ path: 'screenshots/15-profile.png', fullPage: true })
})
