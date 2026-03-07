/**
 * Clean up test users created by Playwright tests.
 * Run manually: node tests/cleanup.js
 *
 * Deletes profiles and auth.users matching test patterns
 * (testuser*, logintest*, threadtest*, screenshotuser*).
 */

import { execSync } from 'child_process'

const container = process.env.PG_CONTAINER || 'go-services-db-1'
const patterns = ['testuser%', 'logintest%', 'threadtest%', 'screenshotuser%']

function psql(sql) {
  return execSync(
    `docker exec ${container} psql -U postgres -t -A -c "${sql}"`,
    { encoding: 'utf-8' }
  ).trim()
}

const where = patterns.map(p => `username LIKE '${p}'`).join(' OR ')

const count = psql(`SELECT count(*) FROM profiles WHERE ${where}`)
console.log(`Found ${count} test users`)

if (parseInt(count) > 0) {
  // Get user IDs from profiles
  const ids = psql(`SELECT id FROM profiles WHERE ${where}`)
  const idList = ids.split('\n').map(id => `'${id}'`).join(',')

  // Delete in FK-safe order: posts → threads → profiles → auth.users
  psql(`DELETE FROM posts WHERE author_id IN (${idList})`)
  psql(`DELETE FROM threads WHERE author_id IN (${idList})`)
  psql(`DELETE FROM bookmarks WHERE user_id IN (${idList})`)
  psql(`DELETE FROM notifications WHERE user_id IN (${idList})`)
  psql(`DELETE FROM profiles WHERE ${where}`)
  psql(`DELETE FROM auth.users WHERE id IN (${idList})`)

  console.log(`Cleaned up ${count} test users`)
} else {
  console.log('Nothing to clean up')
}
