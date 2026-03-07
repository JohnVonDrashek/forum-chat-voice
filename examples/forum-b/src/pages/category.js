import { api } from '../lib/api.js'
import { authStore } from '../lib/auth.js'
import { avatarHTML } from '../components/avatar.js'
import { formatRelativeTime } from '../lib/date.js'
import { toast } from '../lib/toast.js'

export function renderCategory(container, { categorySlug }) {
  container.innerHTML = '<div class="skeleton" style="height:40px;margin-bottom:12px"></div><div class="skeleton" style="height:80px"></div>'

  Promise.all([
    api.getCategory(categorySlug),
    api.getThreadsByCategory(categorySlug),
    api.getChannelFollows().catch(() => []),
  ]).then(([category, threads, follows]) => {
    if (!category) {
      container.innerHTML = '<div class="empty-state"><p>Category not found in this realm.</p></div>'
      return
    }

    const { user } = authStore.get()
    const isFollowing = follows.some(f => f.category_id === category.id)

    container.innerHTML = `
      <div style="margin-bottom:12px">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 style="font-family:var(--font-heading);font-size:20px;color:var(--accent-pink);text-shadow:var(--glow-pink)">${escapeHTML(category.name)}</h1>
            ${category.description ? `<p style="font-size:12px;color:var(--text-muted);margin-top:2px">${escapeHTML(category.description)}</p>` : ''}
          </div>
          <div class="flex items-center gap-1">
            ${user ? `
              <button id="follow-btn" class="btn btn-small ${isFollowing ? 'btn-primary' : ''}">${isFollowing ? 'Following' : 'Follow'}</button>
              <a href="/c/${categorySlug}/new" class="btn btn-primary btn-small">New Thread</a>
            ` : ''}
          </div>
        </div>
      </div>
      <div class="gothic-box">
        <div class="gothic-box-header">~ Threads ~</div>
        <div class="gothic-box-content" id="thread-list" style="padding:0">
          ${threads.length ? threads.map(t => threadCard(t)).join('') : '<div class="empty-state"><p>No threads yet. Be the first to speak...</p></div>'}
        </div>
      </div>
    `

    const followBtn = container.querySelector('#follow-btn')
    if (followBtn) {
      let following = isFollowing
      followBtn.addEventListener('click', async () => {
        try {
          if (following) {
            await api.unfollowCategory(category.id)
            following = false
            followBtn.textContent = 'Follow'
            followBtn.classList.remove('btn-primary')
          } else {
            await api.followCategory(category.id)
            following = true
            followBtn.textContent = 'Following'
            followBtn.classList.add('btn-primary')
          }
        } catch { toast.error('Failed to update follow status') }
      })
    }
  }).catch(() => {
    container.innerHTML = `
      <div class="empty-state">
        <p style="color:var(--accent-red)">Failed to load category.</p>
        <button id="retry-cat" class="btn btn-small mt-2">Try again</button>
      </div>
    `
    container.querySelector('#retry-cat')?.addEventListener('click', () => renderCategory(container, { categorySlug }))
  })
}

function threadCard(t) {
  return `
    <a href="/t/${t.id}" class="thread-card">
      ${avatarHTML({ avatarUrl: t.image_url || t.author?.avatar_url, size: 36 })}
      <div class="min-w-0" style="flex:1">
        <div class="flex items-center gap-1 flex-wrap">
          ${t.is_pinned ? '<span class="tag tag-pinned">Pinned</span>' : ''}
          ${t.is_locked ? '<span class="tag tag-locked">Locked</span>' : ''}
        </div>
        <div class="thread-card-title">${escapeHTML(t.title)}</div>
        <div class="thread-card-meta">
          ${escapeHTML(t.author?.display_name || t.author?.username || 'Unknown')}
          &middot; ${formatRelativeTime(t.created_at)}
          &middot; ${t.post_count || 0} replies
        </div>
      </div>
    </a>
  `
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}
