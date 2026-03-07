/**
 * GoTrue auth module — manages session, token refresh, sign in/up/out.
 * Port of gotrue-auth-provider.ts + auth.tsx combined into a single module.
 */

import { createStore } from '../state.js'
import { api } from './api.js'
import { uploadDefaultAvatar } from './avatars.js'

const STORAGE_KEY = 'gotrue-session'
const anonKey = import.meta.env.VITE_AUTH_ANON_KEY || ''

// Auth state store
export const authStore = createStore({
  user: null,     // { id, email, username, avatar, user_metadata }
  profile: null,  // full profile row
  loading: true,
})

let currentSession = null
let refreshTimer = null
const listeners = new Set()

// --- Internal helpers ---

function gotrueHeaders(token) {
  const h = { 'Content-Type': 'application/json', 'apikey': anonKey }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

function saveSession(session) {
  currentSession = session
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    scheduleRefresh(session)
  } else {
    localStorage.removeItem(STORAGE_KEY)
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
  }
}

function scheduleRefresh(session) {
  if (refreshTimer) clearTimeout(refreshTimer)
  const expiresAt = session.expires_at * 1000
  const refreshIn = Math.max(expiresAt - Date.now() - 60000, 5000)
  refreshTimer = setTimeout(refreshSession, refreshIn)
}

async function refreshSession() {
  if (!currentSession?.refresh_token) return false
  try {
    const res = await fetch('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
      body: JSON.stringify({ refresh_token: currentSession.refresh_token }),
    })
    if (!res.ok) {
      saveSession(null)
      authStore.set({ user: null, profile: null, loading: false })
      return false
    }
    const session = await res.json()
    saveSession(session)
    return true
  } catch {
    return false
  }
}

async function fetchProfile(userId) {
  return api.getProfile(userId)
}

async function ensureProfile(rawUser) {
  let prof = await fetchProfile(rawUser.id)
  if (prof) {
    authStore.set({ profile: prof })
    return prof
  }

  // Create profile
  const username = rawUser.user_metadata?.username
    || rawUser.email?.split('@')[0]
    || `user_${rawUser.id.slice(0, 8)}`
  const displayName = rawUser.user_metadata?.display_name || username

  try {
    await api.upsertProfile(rawUser.id, { username, display_name: displayName, avatar_url: null })
  } catch (err) {
    console.error('Failed to create profile:', err)
    return null
  }

  // Generate default avatar
  const token = await getAccessToken()
  const avatarUrl = token ? await uploadDefaultAvatar(rawUser.id, 'user', token) : null
  if (avatarUrl) {
    await api.updateProfile(rawUser.id, { avatar_url: avatarUrl })
  }

  prof = await fetchProfile(rawUser.id)
  if (prof) authStore.set({ profile: prof })
  return prof
}

function toAppUser(rawUser, prof) {
  if (!rawUser) return null
  return {
    id: rawUser.id,
    email: rawUser.email || '',
    username: prof?.username,
    avatar: prof?.avatar_url || undefined,
    is_admin: prof?.is_admin || false,
    user_metadata: {
      username: prof?.username || rawUser.user_metadata?.username,
    },
  }
}

// --- Public API ---

export async function getAccessToken() {
  if (!currentSession) return null
  if (currentSession.expires_at * 1000 < Date.now()) {
    const ok = await refreshSession()
    if (!ok) return null
  }
  return currentSession.access_token
}

export async function signIn(email, password) {
  try {
    const res = await fetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: new Error(body.error_description || body.msg || 'Login failed') }
    }
    const session = await res.json()
    saveSession(session)

    const prof = await ensureProfile(session.user)
    authStore.set({ user: toAppUser(session.user, prof), loading: false })
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err : new Error('Login failed') }
  }
}

export async function signUp(email, password, username) {
  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, username }),
    })
    const body = await res.json()
    if (!res.ok) {
      return { error: new Error(body.error || 'Signup failed') }
    }

    if (body.session?.access_token && body.session?.refresh_token) {
      const userRes = await fetch('/auth/v1/user', {
        headers: { 'Authorization': `Bearer ${body.session.access_token}`, 'apikey': anonKey },
      })
      const user = userRes.ok ? await userRes.json() : { id: body.user?.id || '', email }
      const session = {
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
        expires_in: body.session.expires_in || 3600,
        expires_at: body.session.expires_at || Math.floor(Date.now() / 1000) + 3600,
        user,
      }
      saveSession(session)

      const prof = await ensureProfile(user)
      authStore.set({ user: toAppUser(user, prof), loading: false })
    }
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err : new Error('Signup failed') }
  }
}

export async function signOut() {
  try {
    if (currentSession?.access_token) {
      await fetch('/auth/v1/logout', {
        method: 'POST',
        headers: gotrueHeaders(currentSession.access_token),
      })
    }
  } catch {}
  saveSession(null)
  authStore.set({ user: null, profile: null, loading: false })
}

export async function resetPassword(email) {
  try {
    const res = await fetch('/auth/v1/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
      body: JSON.stringify({ email, gotrue_meta_security: { captcha_token: '' } }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: new Error(body.msg || 'Password reset failed') }
    }
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err : new Error('Password reset failed') }
  }
}

export async function updatePassword(newPassword) {
  try {
    const res = await fetch('/auth/v1/user', {
      method: 'PUT',
      headers: gotrueHeaders(currentSession?.access_token),
      body: JSON.stringify({ password: newPassword }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: new Error(body.msg || 'Password update failed') }
    }
    const user = await res.json()
    if (currentSession) {
      currentSession.user = user
      saveSession(currentSession)
    }
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err : new Error('Password update failed') }
  }
}

async function restoreSessionFromUrl() {
  const hash = window.location.hash
  if (!hash) return false
  const params = new URLSearchParams(hash.substring(1))
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return false

  try {
    const userRes = await fetch('/auth/v1/user', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': anonKey },
    })
    if (!userRes.ok) return false
    const user = await userRes.json()

    const payload = JSON.parse(atob(accessToken.split('.')[1]))
    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: (payload.exp - payload.iat) || 3600,
      expires_at: payload.exp || Math.floor(Date.now() / 1000) + 3600,
      user,
    }
    saveSession(session)

    if (params.get('type') === 'recovery') {
      window.location.href = '/reset-password'
    }

    window.history.replaceState({}, '', window.location.pathname)
    return true
  } catch {
    return false
  }
}

// --- Init ---

export async function initAuth() {
  // Restore from localStorage
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      currentSession = JSON.parse(stored)
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }
  if (currentSession) scheduleRefresh(currentSession)

  // Check URL hash for OAuth/recovery tokens
  await restoreSessionFromUrl()

  // Strip ?forumline_auth=success
  const params = new URLSearchParams(window.location.search)
  if (params.has('forumline_auth')) {
    params.delete('forumline_auth')
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params}`
      : window.location.pathname
    window.history.replaceState({}, '', newUrl)
  }

  // Load profile if session exists
  if (currentSession?.user) {
    try {
      const prof = await ensureProfile(currentSession.user)
      authStore.set({ user: toAppUser(currentSession.user, prof), loading: false })
    } catch {
      authStore.set({ user: toAppUser(currentSession.user, null), loading: false })
    }
  } else {
    authStore.set({ loading: false })
  }
}
