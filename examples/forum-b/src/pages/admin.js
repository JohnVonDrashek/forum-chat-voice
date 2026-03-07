import { api } from '../lib/api.js'
import { authStore } from '../lib/auth.js'
import { avatarHTML } from '../components/avatar.js'
import { formatRelativeTime } from '../lib/date.js'

export function renderAdmin(container) {
  const { user } = authStore.get()
  if (!user?.is_admin) {
    container.innerHTML = `
      <div class="gothic-box" style="margin-top:40px">
        <div class="gothic-box-header">~ Access Denied ~</div>
        <div class="gothic-box-content text-center">
          <p style="color:var(--accent-red)">You do not possess the power to enter this domain.</p>
        </div>
      </div>
    `
    return
  }

  let tab = 'overview'

  async function render() {
    container.innerHTML = `
      <div class="gothic-box">
        <div class="gothic-box-header">~ Admin Dashboard ~</div>
        <div class="gothic-box-content">
          <div class="tab-bar">
            ${['overview', 'users', 'content', 'reports'].map(t => `
              <button class="tab-btn ${t === tab ? 'active' : ''}" data-tab="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>
            `).join('')}
          </div>
          <div id="admin-content"></div>
        </div>
      </div>
    `

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; render() })
    })

    const content = container.querySelector('#admin-content')

    if (tab === 'overview') {
      try {
        const stats = await api.getAdminStats()
        content.innerHTML = `
          <div class="stat-grid">
            <div class="stat-card">
              <div class="stat-card-value">${(stats.totalUsers || 0).toLocaleString()}</div>
              <div class="stat-card-label">Users</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value">${(stats.totalThreads || 0).toLocaleString()}</div>
              <div class="stat-card-label">Threads</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value">${(stats.totalPosts || 0).toLocaleString()}</div>
              <div class="stat-card-label">Posts</div>
            </div>
          </div>
        `
      } catch { content.innerHTML = '<p style="color:var(--accent-red)">Failed to load stats.</p>' }
    } else if (tab === 'users') {
      try {
        const users = await api.getAdminUsers()
        let searchQuery = ''

        function renderUsers() {
          const filtered = searchQuery
            ? users.filter(u => u.username.toLowerCase().includes(searchQuery) || (u.display_name || '').toLowerCase().includes(searchQuery))
            : users

          content.innerHTML = `
            <div class="form-group">
              <input id="user-search" type="text" placeholder="Search users..." value="${searchQuery}" class="form-input" style="max-width:300px" />
            </div>
            <table class="gothic-table">
              <thead><tr><th>User</th><th>Role</th><th>Joined</th></tr></thead>
              <tbody>
                ${filtered.map(u => `
                  <tr>
                    <td>
                      <div class="flex items-center gap-2">
                        ${avatarHTML({ avatarUrl: u.avatar_url, size: 24 })}
                        <div>
                          <a href="/u/${u.username}" class="link-pink" style="font-weight:bold">${escapeHTML(u.display_name || u.username)}</a>
                          <div style="font-size:10px;color:var(--text-muted)">@${escapeHTML(u.username)}</div>
                        </div>
                      </div>
                    </td>
                    <td><span class="tag ${u.is_admin ? 'tag-admin' : 'tag-user'}">${u.is_admin ? 'Admin' : 'User'}</span></td>
                    <td style="color:var(--text-muted)">${formatRelativeTime(u.created_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `

          content.querySelector('#user-search')?.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase()
            renderUsers()
          })
        }

        renderUsers()
      } catch { content.innerHTML = '<p style="color:var(--accent-red)">Failed to load users.</p>' }
    } else if (tab === 'content') {
      content.innerHTML = '<div class="empty-state"><p>Content management coming soon...</p></div>'
    } else if (tab === 'reports') {
      content.innerHTML = '<div class="empty-state"><p>No reports to review.</p></div>'
    }
  }

  render()
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}
