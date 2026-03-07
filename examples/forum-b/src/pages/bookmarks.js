import { api } from '../lib/api.js'
import { authStore } from '../lib/auth.js'
import { avatarHTML } from '../components/avatar.js'
import { formatRelativeTime } from '../lib/date.js'
import { toast } from '../lib/toast.js'

export function renderBookmarks(container) {
  const { user } = authStore.get()
  if (!user) {
    container.innerHTML = '<div class="empty-state"><p><a href="/login" class="link-pink">Sign in</a> to view bookmarks.</p></div>'
    return
  }

  container.innerHTML = '<div class="skeleton" style="height:30px;margin-bottom:8px"></div><div class="skeleton" style="height:60px"></div>'

  let bookmarks = []

  function render() {
    container.innerHTML = `
      <div class="gothic-box">
        <div class="gothic-box-header">~ Bookmarks ~ <span style="font-size:10px;color:var(--text-muted);font-weight:normal">(${bookmarks.length} saved)</span></div>
        <div class="gothic-box-content" style="padding:0">
          ${bookmarks.length ? bookmarks.map(b => `
            <div class="thread-card">
              <a href="/t/${b.thread.id}" class="flex items-center gap-2 min-w-0" style="flex:1;color:var(--text-main)">
                ${avatarHTML({ avatarUrl: b.thread.image_url || b.thread.author?.avatar_url, size: 32 })}
                <div class="min-w-0">
                  <div class="thread-card-title truncate">${escapeHTML(b.thread.title)}</div>
                  <div class="thread-card-meta">
                    <span style="color:var(--accent-purple)">${escapeHTML(b.thread.category?.name || '')}</span>
                    &middot; ${escapeHTML(b.thread.author?.display_name || '')}
                    &middot; saved ${formatRelativeTime(b.created_at)}
                  </div>
                </div>
              </a>
              <button class="remove-bookmark" data-id="${b.id}" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;font-family:var(--font-main)">[x]</button>
            </div>
          `).join('') : '<div class="empty-state"><p>No bookmarks yet. <a href="/" class="link-pink">Browse threads</a></p></div>'}
        </div>
      </div>
    `

    container.querySelectorAll('.remove-bookmark').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.removeBookmarkById(btn.dataset.id)
          bookmarks = bookmarks.filter(b => b.id !== btn.dataset.id)
          render()
        } catch { toast.error('Failed to remove bookmark') }
      })
    })
  }

  api.getBookmarksWithMeta().then(data => { bookmarks = data || []; render() }).catch(() => {
    container.innerHTML = '<div class="empty-state"><p style="color:var(--accent-red)">Failed to load bookmarks.</p><button id="retry-bm" class="btn btn-small mt-2">Try again</button></div>'
    container.querySelector('#retry-bm')?.addEventListener('click', () => renderBookmarks(container))
  })
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}
