/**
 * GoTrueAuthProvider — Direct GoTrue REST API implementation of ForumAuthProvider.
 * Replaces SupabaseAuthProvider, eliminating the @supabase/supabase-js dependency.
 *
 * Auth calls go through the Go proxy at /auth/v1/* which forwards to the forum GoTrue.
 */

import type {
  ForumAuthProvider,
  AuthSession,
  AuthCallback,
  AuthStateEvent,
  Unsubscribe,
} from './auth-provider'

const STORAGE_KEY = 'gotrue-session'
const anonKey = import.meta.env.VITE_AUTH_ANON_KEY || ''

interface GoTrueSession {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at: number
  user: GoTrueUser
}

interface GoTrueUser {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}

export class GoTrueAuthProvider implements ForumAuthProvider {
  private listeners: Set<AuthCallback> = new Set()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private currentSession: GoTrueSession | null = null

  constructor() {
    // Restore session from localStorage on init
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        this.currentSession = JSON.parse(stored)
      } catch {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
    // Schedule refresh if session exists
    if (this.currentSession) {
      this.scheduleRefresh(this.currentSession)
    }
  }

  private async gotrueRequest(path: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      ...(options.headers as Record<string, string> || {}),
    }
    if (this.currentSession?.access_token) {
      headers['Authorization'] = `Bearer ${this.currentSession.access_token}`
    }
    return fetch(`/auth/v1${path}`, { ...options, headers })
  }

  private saveSession(session: GoTrueSession | null) {
    this.currentSession = session
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
      this.scheduleRefresh(session)
    } else {
      localStorage.removeItem(STORAGE_KEY)
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer)
        this.refreshTimer = null
      }
    }
  }

  private scheduleRefresh(session: GoTrueSession) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    // Refresh 60 seconds before expiry
    const expiresAt = session.expires_at * 1000
    const refreshIn = Math.max(expiresAt - Date.now() - 60_000, 5_000)
    this.refreshTimer = setTimeout(() => this.refreshSession(), refreshIn)
  }

  private async refreshSession(): Promise<boolean> {
    if (!this.currentSession?.refresh_token) return false
    try {
      const res = await fetch('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
        body: JSON.stringify({ refresh_token: this.currentSession.refresh_token }),
      })
      if (!res.ok) {
        this.saveSession(null)
        this.emit('SIGNED_OUT', null)
        return false
      }
      const session: GoTrueSession = await res.json()
      this.saveSession(session)
      this.emit('TOKEN_REFRESHED', this.toAuthSession(session))
      return true
    } catch {
      return false
    }
  }

  private toAuthSession(session: GoTrueSession): AuthSession {
    return {
      access_token: session.access_token,
      user: {
        id: session.user.id,
        email: session.user.email || '',
        user_metadata: {
          username: session.user.user_metadata?.username as string | undefined,
        },
      },
    }
  }

  private emit(event: AuthStateEvent, session: AuthSession | null) {
    for (const cb of this.listeners) {
      try { cb(event, session) } catch {}
    }
  }

  async signIn(email: string, password: string): Promise<{ error: Error | null }> {
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
      const session: GoTrueSession = await res.json()
      this.saveSession(session)
      this.emit('SIGNED_IN', this.toAuthSession(session))
      return { error: null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Login failed') }
    }
  }

  async signUp(email: string, password: string, username: string): Promise<{ error: Error | null; userId?: string }> {
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
      // Set session from the signup response
      if (body.session?.access_token && body.session?.refresh_token) {
        // Fetch full user data from GoTrue
        const userRes = await fetch('/auth/v1/user', {
          headers: {
            'Authorization': `Bearer ${body.session.access_token}`,
            'apikey': anonKey,
          },
        })
        const user: GoTrueUser = userRes.ok ? await userRes.json() : { id: body.user?.id || '', email }
        const session: GoTrueSession = {
          access_token: body.session.access_token,
          refresh_token: body.session.refresh_token,
          expires_in: body.session.expires_in || 3600,
          expires_at: body.session.expires_at || Math.floor(Date.now() / 1000) + 3600,
          user,
        }
        this.saveSession(session)
        this.emit('SIGNED_IN', this.toAuthSession(session))
      }
      return { error: null, userId: body.user?.id }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Signup failed') }
    }
  }

  async signOut(): Promise<void> {
    try {
      if (this.currentSession?.access_token) {
        await this.gotrueRequest('/logout', { method: 'POST' })
      }
    } catch {}
    this.saveSession(null)
    this.emit('SIGNED_OUT', null)
  }

  async resetPassword(email: string): Promise<{ error: Error | null }> {
    try {
      const res = await fetch('/auth/v1/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
        body: JSON.stringify({ email, gotrue_meta_security: { captcha_token: '' } }),
      })
      // GoTrue /recover always returns 200 to prevent email enumeration
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { error: new Error(body.msg || 'Password reset failed') }
      }
      return { error: null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Password reset failed') }
    }
  }

  async updatePassword(newPassword: string): Promise<{ error: Error | null }> {
    try {
      const res = await this.gotrueRequest('/user', {
        method: 'PUT',
        body: JSON.stringify({ password: newPassword }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { error: new Error(body.msg || 'Password update failed') }
      }
      // Update stored user data
      const user: GoTrueUser = await res.json()
      if (this.currentSession) {
        this.currentSession.user = user
        this.saveSession(this.currentSession)
      }
      return { error: null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Password update failed') }
    }
  }

  async getSession(): Promise<AuthSession | null> {
    if (!this.currentSession) return null
    // Check if token is expired
    if (this.currentSession.expires_at * 1000 < Date.now()) {
      const refreshed = await this.refreshSession()
      if (!refreshed) return null
    }
    return this.toAuthSession(this.currentSession)
  }

  async getRawUser(): Promise<{ id: string; email?: string; user_metadata?: Record<string, unknown> } | null> {
    if (!this.currentSession) return null
    // Check if token is expired
    if (this.currentSession.expires_at * 1000 < Date.now()) {
      const refreshed = await this.refreshSession()
      if (!refreshed) return null
    }
    return {
      id: this.currentSession.user.id,
      email: this.currentSession.user.email,
      user_metadata: this.currentSession.user.user_metadata,
    }
  }

  async restoreSessionFromUrl(): Promise<boolean> {
    const hash = window.location.hash
    if (!hash) return false
    const params = new URLSearchParams(hash.substring(1))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (!accessToken || !refreshToken) return false

    console.log('[FLD:Auth] Detected session tokens in URL hash, setting session...')
    // Fetch user data using the access token
    try {
      const userRes = await fetch('/auth/v1/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': anonKey,
        },
      })
      if (!userRes.ok) {
        console.error('[FLD:Auth] Failed to fetch user from hash token')
        return false
      }
      const user: GoTrueUser = await userRes.json()

      // Decode token to get expiry
      const payload = JSON.parse(atob(accessToken.split('.')[1]))
      const session: GoTrueSession = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: (payload.exp - payload.iat) || 3600,
        expires_at: payload.exp || Math.floor(Date.now() / 1000) + 3600,
        user,
      }
      this.saveSession(session)
      // Check for password recovery
      const type = params.get('type')
      if (type === 'recovery') {
        this.emit('PASSWORD_RECOVERY', this.toAuthSession(session))
      } else {
        this.emit('SIGNED_IN', this.toAuthSession(session))
      }
      // Clear hash
      window.history.replaceState({}, '', window.location.pathname)
      return true
    } catch (err) {
      console.error('[FLD:Auth] Failed to restore session from URL:', err)
      return false
    }
  }

  onAuthStateChange(callback: AuthCallback): Unsubscribe {
    this.listeners.add(callback)
    // Fire initial session event
    if (this.currentSession) {
      setTimeout(() => callback('INITIAL_SESSION', this.toAuthSession(this.currentSession!)), 0)
    } else {
      setTimeout(() => callback('INITIAL_SESSION', null), 0)
    }
    return () => { this.listeners.delete(callback) }
  }
}
