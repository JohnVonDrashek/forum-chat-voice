import { api } from '../lib/api.js'
import { authStore } from '../lib/auth.js'
import { avatarHTML } from '../components/avatar.js'
import { formatRelativeTime, formatDate } from '../lib/date.js'

export function renderProfile(container, { username }) {
  container.innerHTML = '<div class="skeleton" style="height:100px"></div>'

  api.getProfileByUsername(username).then(async profile => {
    if (!profile) {
      container.innerHTML = '<div class="empty-state"><p>User not found in this realm.</p></div>'
      return
    }

    const { user } = authStore.get()
    const [threads, posts] = await Promise.all([
      api.getUserThreads(profile.id),
      api.getUserPosts(profile.id),
    ])

    let tab = 'threads'

    function render() {
      const showMessage = user && profile.id !== user.id

      container.innerHTML = `
        <div class="gothic-box">
          <div class="gothic-box-header">~ Profile ~</div>
          <div class="gothic-box-content">
            <div class="profile-card">
              ${avatarHTML({ avatarUrl: profile.avatar_url, size: 56, showGlobe: !!profile.forumline_id })}
              <div class="profile-info">
                <h1>${escapeHTML(profile.display_name || profile.username)}</h1>
                <div class="username">@${escapeHTML(profile.username)}</div>
                ${profile.bio ? `<div class="bio">${escapeHTML(profile.bio)}</div>` : ''}
                <div class="profile-stats">
                  <span>${threads.length} threads</span>
                  <span>${posts.length} posts</span>
                  <span>Joined ${formatDate(profile.created_at)}</span>
                </div>
                ${showMessage ? `
                  <a href="/dm/${profile.id}" class="btn btn-primary btn-small" style="margin-top:8px">Message</a>
                ` : ''}
              </div>
            </div>
          </div>
        </div>

        <div class="tab-bar">
          <button class="tab-btn ${tab === 'threads' ? 'active' : ''}" data-tab="threads">Threads (${threads.length})</button>
          <button class="tab-btn ${tab === 'posts' ? 'active' : ''}" data-tab="posts">Posts (${posts.length})</button>
        </div>

        <div id="tab-content">
          ${tab === 'threads' ? renderThreads(threads) : renderPosts(posts)}
        </div>
      `

      container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => { tab = btn.dataset.tab; render() })
      })
    }

    render()
  }).catch(() => {
    container.innerHTML = '<div class="empty-state"><p style="color:var(--accent-red)">Failed to load profile.</p></div>'
  })
}

function renderThreads(threads) {
  if (!threads.length) return '<div class="empty-state"><p>No threads yet.</p></div>'
  return `<div class="gothic-box"><div class="gothic-box-content" style="padding:0">
    ${threads.map(t => `
      <a href="/t/${t.id}" class="thread-card">
        <div class="min-w-0" style="flex:1">
          <div class="flex items-center gap-1">
            ${t.is_pinned ? '<span class="tag tag-pinned">Pinned</span>' : ''}
            <span class="thread-card-title">${escapeHTML(t.title)}</span>
          </div>
          <div class="thread-card-meta">
            in <span style="color:var(--accent-purple)">${escapeHTML(t.category?.name || '')}</span>
            &middot; ${formatRelativeTime(t.created_at)} &middot; ${t.post_count || 0} replies
          </div>
        </div>
      </a>
    `).join('')}
  </div></div>`
}

function renderPosts(posts) {
  if (!posts.length) return '<div class="empty-state"><p>No posts yet.</p></div>'
  return `<div class="gothic-box"><div class="gothic-box-content" style="padding:0">
    ${posts.map(p => `
      <a href="/t/${p.thread_id}#post-${p.id}" class="thread-card">
        <div class="min-w-0" style="flex:1">
          <div style="font-size:12px">${escapeHTML(p.content)}</div>
          <div class="thread-card-meta">${formatRelativeTime(p.created_at)}</div>
        </div>
      </a>
    `).join('')}
  </div></div>`
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}
