import { authStore, getAccessToken, updatePassword } from '../lib/auth.js'
import { api } from '../lib/api.js'
import { uploadAvatar } from '../lib/avatars.js'
import { toast } from '../lib/toast.js'
import { showCropModal } from '../components/image-crop-modal.js'

export function renderSettings(container) {
  const { user, profile } = authStore.get()
  if (!user) {
    container.innerHTML = '<div class="empty-state"><p><a href="/login" class="link-pink">Sign in</a> to access settings.</p></div>'
    return
  }

  let tab = 'profile'
  let formData = {
    display_name: profile?.display_name || '',
    bio: profile?.bio || '',
    website: profile?.website || '',
    avatar_url: profile?.avatar_url || '',
  }

  function render() {
    container.innerHTML = `
      <div class="gothic-box">
        <div class="gothic-box-header">~ Settings ~</div>
        <div class="gothic-box-content">
          <div class="tab-bar">
            ${['profile', 'account', 'notifications', 'appearance'].map(t => `
              <button class="tab-btn ${t === tab ? 'active' : ''}" data-tab="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>
            `).join('')}
          </div>
          <div id="tab-content"></div>
        </div>
      </div>
    `

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; render() })
    })

    const content = container.querySelector('#tab-content')
    if (tab === 'profile') renderProfileTab(content)
    else if (tab === 'account') renderAccountTab(content)
    else if (tab === 'notifications') renderNotificationsTab(content)
    else if (tab === 'appearance') renderAppearanceTab(content)
  }

  function renderProfileTab(el) {
    el.innerHTML = `
      <div style="max-width:400px">
        <div class="form-group">
          <label class="form-label">Avatar</label>
          <div class="flex items-center gap-2">
            <img src="${formData.avatar_url || ''}" alt="" class="avatar" style="width:48px;height:48px" />
            <input type="file" id="avatar-file" accept="image/*" style="font-size:12px;color:var(--text-muted)" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Display Name</label>
          <input type="text" id="display-name" value="${escapeAttr(formData.display_name)}" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label">Bio</label>
          <textarea id="bio" rows="3" class="form-input">${escapeHTML(formData.bio)}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Website</label>
          <input type="url" id="website" value="${escapeAttr(formData.website)}" placeholder="https://" class="form-input" />
        </div>
        <button id="save-profile" class="btn btn-primary">Save</button>
      </div>
    `

    el.querySelector('#avatar-file').addEventListener('change', async (e) => {
      const file = e.target.files[0]
      if (!file) return
      e.target.value = ''
      const imageSrc = URL.createObjectURL(file)
      const blob = await showCropModal(imageSrc)
      URL.revokeObjectURL(imageSrc)
      if (!blob) return
      const token = await getAccessToken()
      if (!token) return
      const url = await uploadAvatar(blob, `user/${user.id}/avatar.png`, token)
      if (url) { formData.avatar_url = url; el.querySelector('img').src = url }
    })

    el.querySelector('#save-profile').addEventListener('click', async () => {
      const btn = el.querySelector('#save-profile')
      btn.disabled = true; btn.textContent = 'Saving...'

      formData.display_name = el.querySelector('#display-name').value
      formData.bio = el.querySelector('#bio').value
      formData.website = el.querySelector('#website').value

      try {
        await api.updateProfile(user.id, formData)
        toast.success('Profile updated')
        const newProfile = await api.getProfile(user.id)
        if (newProfile) authStore.set({ profile: newProfile, user: { ...user, username: newProfile.username, avatar: newProfile.avatar_url } })
      } catch { toast.error('Failed to save profile') }
      btn.disabled = false; btn.textContent = 'Save'
    })
  }

  function renderAccountTab(el) {
    el.innerHTML = `
      <div style="max-width:400px">
        <h3 style="font-family:var(--font-heading);color:var(--accent-pink);margin-bottom:8px">Change Password</h3>
        <div class="form-group">
          <input type="password" id="new-password" placeholder="New password" class="form-input" />
        </div>
        <div class="form-group">
          <input type="password" id="confirm-password" placeholder="Confirm password" class="form-input" />
        </div>
        <div id="password-error" class="form-error"></div>
        <button id="change-password" class="btn btn-primary">Update Password</button>

        <div style="border-top:1px dashed var(--border-main);margin-top:16px;padding-top:16px">
          <h3 style="font-family:var(--font-heading);color:var(--accent-pink);margin-bottom:8px">Forumline Connection</h3>
          ${profile?.forumline_id ? `
            <div class="flex items-center gap-2" style="font-size:12px">
              <span style="color:var(--accent-green)">Connected</span>
              <button id="disconnect-forumline" style="color:var(--accent-red);background:none;border:none;font-family:var(--font-main);cursor:pointer;font-size:12px">[disconnect]</button>
            </div>
          ` : `<a href="/api/forumline/auth" class="btn btn-small">Connect Forumline Account</a>`}
        </div>
      </div>
    `

    el.querySelector('#change-password')?.addEventListener('click', async () => {
      const newPw = el.querySelector('#new-password').value
      const confirmPw = el.querySelector('#confirm-password').value
      const errorEl = el.querySelector('#password-error')

      if (newPw !== confirmPw) { errorEl.textContent = 'Passwords do not match'; errorEl.classList.add('visible'); return }
      if (newPw.length < 6) { errorEl.textContent = 'Password must be at least 6 characters'; errorEl.classList.add('visible'); return }

      const { error } = await updatePassword(newPw)
      if (error) { errorEl.textContent = error.message; errorEl.classList.add('visible') }
      else {
        toast.success('Password updated')
        el.querySelector('#new-password').value = ''
        el.querySelector('#confirm-password').value = ''
        errorEl.classList.remove('visible')
      }
    })

    el.querySelector('#disconnect-forumline')?.addEventListener('click', async () => {
      try {
        await fetch(`/api/profiles/${user.id}/forumline-id`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${await getAccessToken()}` } })
        toast.success('Forumline disconnected')
        render()
      } catch { toast.error('Failed to disconnect') }
    })
  }

  function renderNotificationsTab(el) {
    el.innerHTML = '<div class="skeleton" style="height:100px"></div>'

    api.getNotificationPreferences().then(prefs => {
      const categories = [
        { key: 'thread_replies', label: 'Replies to your threads' },
        { key: 'post_mentions', label: 'Mentions in posts' },
        { key: 'chat_mentions', label: 'Mentions in chat' },
        { key: 'direct_messages', label: 'Direct messages' },
      ]

      el.innerHTML = `
        <div style="max-width:400px">
          ${categories.map(cat => {
            const pref = prefs?.find(p => p.category === cat.key)
            const enabled = pref?.enabled ?? true
            return `
              <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px dashed rgba(61,43,90,0.3)">
                <span style="font-size:13px">${cat.label}</span>
                <button class="notif-toggle toggle-track ${enabled ? 'on' : ''}" data-category="${cat.key}" data-enabled="${enabled}">
                  <div class="toggle-thumb"></div>
                </button>
              </div>
            `
          }).join('')}
        </div>
      `

      el.querySelectorAll('.notif-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
          const enabled = btn.dataset.enabled === 'true'
          const newEnabled = !enabled
          btn.dataset.enabled = String(newEnabled)
          btn.classList.toggle('on', newEnabled)
          try { await api.updateNotificationPreference(btn.dataset.category, newEnabled) }
          catch { toast.error('Failed to update preference') }
        })
      })
    }).catch(() => { el.innerHTML = '<p style="color:var(--accent-red)">Failed to load preferences.</p>' })
  }

  function renderAppearanceTab(el) {
    el.innerHTML = `
      <div class="empty-state">
        <p style="color:var(--accent-purple);font-family:var(--font-heading)">~ The darkness is the only theme ~</p>
        <p style="font-size:12px;margin-top:4px">Appearance customization coming soon...</p>
      </div>
    `
  }

  render()
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
