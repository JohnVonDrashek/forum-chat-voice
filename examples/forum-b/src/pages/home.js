import { api } from '../lib/api.js'
import { avatarHTML } from '../components/avatar.js'
import { formatRelativeTime } from '../lib/date.js'

export function renderHome(container) {
  container.innerHTML = `
    <div class="welcome-banner">
      <h1>~ Welcome to The Dark Forum ~</h1>
      <p>A place for wanderers, seekers, and those who dwell in the digital night.</p>
    </div>
    <div class="gothic-box">
      <div class="gothic-box-header">~ Recent Discussions ~</div>
      <div class="gothic-box-content" id="thread-list">
        ${[1,2,3,4,5].map(() => `
          <div class="thread-card">
            <div class="skeleton" style="width:36px;height:36px;border-radius:50%;flex-shrink:0"></div>
            <div style="flex:1">
              <div class="skeleton" style="width:60%;height:14px;margin-bottom:6px"></div>
              <div class="skeleton" style="width:40%;height:10px"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `

  api.getThreads(20).then(threads => {
    const list = container.querySelector('#thread-list')
    if (!threads?.length) {
      list.innerHTML = '<div class="empty-state"><p>No discussions yet. The void awaits your words...</p></div>'
      return
    }

    list.innerHTML = threads.map(t => `
      <a href="/t/${t.id}" class="thread-card">
        ${avatarHTML({ avatarUrl: t.image_url || t.author?.avatar_url, size: 36 })}
        <div class="min-w-0" style="flex:1">
          <div class="flex items-center gap-1 flex-wrap">
            ${t.is_pinned ? '<span class="tag tag-pinned">Pinned</span>' : ''}
            <span class="tag tag-category">${escapeHTML(t.category?.name || '')}</span>
          </div>
          <div class="thread-card-title" style="margin-top:2px">${escapeHTML(t.title)}</div>
          <div class="thread-card-meta">
            ${avatarHTML({ avatarUrl: t.author?.avatar_url, size: 14, showGlobe: !!t.author?.forumline_id })}
            ${escapeHTML(t.author?.display_name || t.author?.username || 'Unknown')}
            &middot; ${formatRelativeTime(t.created_at)}
            &middot; ${t.post_count || 0} ${t.post_count === 1 ? 'reply' : 'replies'}
          </div>
        </div>
        <div class="last-activity">
          <div style="font-size:11px;color:var(--text-muted)">Last activity</div>
          <div style="font-size:12px;color:var(--accent-purple)">${formatRelativeTime(t.last_post_at || t.updated_at)}</div>
        </div>
      </a>
    `).join('')
  }).catch(() => {
    container.querySelector('#thread-list').innerHTML = `
      <div class="empty-state">
        <p style="color:var(--accent-red)">Failed to load threads.</p>
        <button id="retry-home" class="btn btn-small mt-2">Try again</button>
      </div>
    `
    container.querySelector('#retry-home')?.addEventListener('click', () => renderHome(container))
  })
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}
