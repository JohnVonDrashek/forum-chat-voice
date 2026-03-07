/**
 * Gothic header with glowing title, notifications, user menu.
 */

import { authStore, signOut } from '../lib/auth.js'
import { navigate } from '../router.js'
import { avatarHTML } from './avatar.js'
import { api } from '../lib/api.js'
import { connectSSE } from '../lib/sse.js'
import { formatRelativeTime } from '../lib/date.js'

let notificationCleanup = null
let notifications = []
let dropdownOpen = false
let userMenuOpen = false

export function renderHeader(container) {
  const { user } = authStore.get()

  container.innerHTML = `
    <header class="site-header">
      <div class="flex items-center gap-2">
        <button id="mobile-menu-btn" class="mobile-menu-btn header-btn" style="padding:4px 6px">
          <svg style="width:16px;height:16px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <a href="/" class="site-title">
          <span class="site-title-stars">*</span>The Dark Forum<span class="site-title-stars">*</span>
        </a>
      </div>

      <div class="header-nav">
        <a href="/search" class="header-btn" title="Search">
          <svg style="width:14px;height:14px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </a>
        ${user ? `
          <div class="relative" id="notification-wrapper">
            <button id="notification-btn" class="header-btn relative" style="padding:4px 8px">
              <svg style="width:14px;height:14px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
              <span id="notification-badge" class="notif-badge"></span>
            </button>
            <div id="notification-dropdown" class="dropdown" style="width:280px">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border-main);display:flex;align-items:center;justify-content:space-between">
                <span style="font-size:12px;font-weight:bold;color:var(--accent-pink)">~ Notifications ~</span>
                <button id="mark-all-read" style="font-size:10px;color:var(--accent-purple);background:none;border:none;font-family:var(--font-main);cursor:pointer">Mark all read</button>
              </div>
              <div id="notification-list" style="max-height:300px;overflow-y:auto"></div>
            </div>
          </div>
          <div class="relative" id="user-menu-wrapper">
            <button id="user-menu-btn" class="header-btn" style="padding:2px 6px">
              ${avatarHTML({ avatarUrl: user.avatar, size: 24 })}
            </button>
            <div id="user-menu-dropdown" class="dropdown">
              <a href="/u/${user.username || ''}">Profile</a>
              <a href="/bookmarks">Bookmarks</a>
              <a href="/settings">Settings</a>
              ${user.is_admin ? '<a href="/admin">Admin</a>' : ''}
              <div class="dropdown-divider"></div>
              <button id="sign-out-btn" style="color:var(--accent-red)">Sign Out</button>
            </div>
          </div>
        ` : `
          <a href="/login" class="header-btn">Sign In</a>
          <a href="/register" class="header-btn header-btn--primary">Sign Up</a>
        `}
      </div>
    </header>
  `

  // Mobile menu toggle
  const mobileBtn = container.querySelector('#mobile-menu-btn')
  if (mobileBtn) {
    mobileBtn.addEventListener('click', () => {
      document.getElementById('mobile-sidebar')?.classList.toggle('open')
    })
  }

  // User menu
  const userMenuBtn = container.querySelector('#user-menu-btn')
  const userMenuDropdown = container.querySelector('#user-menu-dropdown')
  if (userMenuBtn && userMenuDropdown) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      userMenuOpen = !userMenuOpen
      userMenuDropdown.classList.toggle('open', userMenuOpen)
    })
  }

  // Sign out
  const signOutBtn = container.querySelector('#sign-out-btn')
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await signOut()
      navigate('/')
    })
  }

  // Notifications
  if (user) setupNotifications(container)

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (userMenuDropdown && !container.querySelector('#user-menu-wrapper')?.contains(e.target)) {
      userMenuDropdown.classList.remove('open')
      userMenuOpen = false
    }
    const notifDropdown = container.querySelector('#notification-dropdown')
    if (notifDropdown && !container.querySelector('#notification-wrapper')?.contains(e.target)) {
      notifDropdown.classList.remove('open')
      dropdownOpen = false
    }
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (userMenuDropdown && userMenuOpen) { userMenuDropdown.classList.remove('open'); userMenuOpen = false }
      const notifDropdown = container.querySelector('#notification-dropdown')
      if (notifDropdown && dropdownOpen) { notifDropdown.classList.remove('open'); dropdownOpen = false }
    }
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
      e.preventDefault()
      navigate('/search')
    }
  })
}

async function setupNotifications(container) {
  try {
    notifications = await api.getNotifications()
    updateNotificationUI(container)
  } catch {}

  notificationCleanup = connectSSE('/api/forumline/notifications/stream', (data) => {
    if (data && data.id) {
      notifications = [data, ...notifications.filter(n => n.id !== data.id)]
      updateNotificationUI(container)
    }
  }, true)

  const notifBtn = container.querySelector('#notification-btn')
  const notifDropdown = container.querySelector('#notification-dropdown')
  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      dropdownOpen = !dropdownOpen
      notifDropdown.classList.toggle('open', dropdownOpen)
    })
  }

  const markAllBtn = container.querySelector('#mark-all-read')
  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      await api.markAllNotificationsRead()
      notifications = notifications.map(n => ({ ...n, read: true }))
      updateNotificationUI(container)
    })
  }
}

function updateNotificationUI(container) {
  const badge = container.querySelector('#notification-badge')
  const list = container.querySelector('#notification-list')
  if (!badge || !list) return

  const unread = notifications.filter(n => !n.read).length
  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : unread
    badge.classList.add('visible')
  } else {
    badge.classList.remove('visible')
  }

  if (notifications.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:16px"><p style="font-size:12px">No notifications</p></div>'
    return
  }

  list.innerHTML = notifications.slice(0, 20).map(n => `
    <a href="${n.link || '#'}" class="notif-item ${n.read ? 'read' : ''}" data-notif-id="${n.id}">
      <div class="notif-item-title">${escapeHTML(n.title)}</div>
      <div class="notif-item-msg">${escapeHTML(n.message)}</div>
      <div class="notif-item-time">${formatRelativeTime(n.created_at)}</div>
    </a>
  `).join('')

  list.querySelectorAll('[data-notif-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.notifId
      if (!notifications.find(n => n.id === id)?.read) {
        api.markNotificationRead(id)
        notifications = notifications.map(n => n.id === id ? { ...n, read: true } : n)
        updateNotificationUI(container)
      }
    })
  })
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

export function cleanupHeader() {
  if (notificationCleanup) { notificationCleanup(); notificationCleanup = null }
}
