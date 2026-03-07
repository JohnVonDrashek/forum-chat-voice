/**
 * GoTrueAuthClient — Direct GoTrue REST API client for Forumline auth.
 * Replaces @supabase/supabase-js auth, using the Go Forumline's auth endpoints.
 *
 * Login/signup go through /api/auth/* (Go handlers that create profiles, set cookies).
 * Token refresh and password operations use the GoTrue proxy at /auth/v1/*.
 */

const STORAGE_KEY = 'forumline-session'

export type AuthStateEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'PASSWORD_RECOVERY'

export interface ForumlineSession {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at: number
  user: HubUser
}

export interface HubUser {
  id: string
  email: string
  user_metadata?: Record<string, unknown>
}

type AuthCallback = (event: AuthStateEvent, session: ForumlineSession | null) => void
type Unsubscribe = () => void

export class GoTrueAuthClient {
  private listeners: Set<AuthCallback> = new Set()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private currentSession: ForumlineSession | null = null

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        this.currentSession = JSON.parse(stored)
      } catch {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
    if (this.currentSession) {
      this.scheduleRefresh(this.currentSession)
    }
  }

  private saveSession(session: ForumlineSession | null) {
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

  private scheduleRefresh(session: ForumlineSession) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    const expiresAt = session.expires_at * 1000
    const refreshIn = Math.max(expiresAt - Date.now() - 60_000, 5_000)
    this.refreshTimer = setTimeout(() => this.refreshSession(), refreshIn)
  }

  private async refreshSession(): Promise<boolean> {
    if (!this.currentSession?.refresh_token) return false
    try {
      const res = await fetch('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.currentSession.refresh_token }),
      })
      if (!res.ok) {
        this.saveSession(null)
        this.emit('SIGNED_OUT', null)
        return false
      }
      const data = await res.json()
      const session: ForumlineSession = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: data.expires_at,
        user: data.user ?? this.currentSession.user,
      }
      this.saveSession(session)
      this.emit('TOKEN_REFRESHED', session)
      return true
    } catch {
      return false
    }
  }

  private emit(event: AuthStateEvent, session: ForumlineSession | null) {
    for (const cb of this.listeners) {
      try { cb(event, session) } catch {}
    }
  }

  async signIn(email: string, password: string): Promise<{ error: Error | null }> {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await res.json()
      if (!res.ok) {
        return { error: new Error(body.error || 'Login failed') }
      }
      const session: ForumlineSession = {
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
        expires_in: body.session.expires_in || 3600,
        expires_at: body.session.expires_at,
        user: {
          id: body.user.id,
          email: body.user.email,
          user_metadata: body.user.user_metadata,
        },
      }
      this.saveSession(session)
      this.emit('SIGNED_IN', session)
      return { error: null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Login failed') }
    }
  }

  async signUp(email: string, password: string, username: string): Promise<{ error: Error | null }> {
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
      const session: ForumlineSession = {
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
        expires_in: body.session.expires_in || 3600,
        expires_at: body.session.expires_at,
        user: {
          id: body.user.id,
          email: body.user.email,
          user_metadata: body.user.user_metadata,
        },
      }
      this.saveSession(session)
      this.emit('SIGNED_IN', session)
      return { error: null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Signup failed') }
    }
  }

  async signOut(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {}
    this.saveSession(null)
    this.emit('SIGNED_OUT', null)
  }

  async resetPasswordForEmail(email: string): Promise<{ error: Error | null }> {
    try {
      const res = await fetch('/auth/v1/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
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

  async updateUser(data: { password: string }): Promise<{ error: Error | null }> {
    if (!this.currentSession) {
      return { error: new Error('Not authenticated') }
    }
    try {
      const res = await fetch('/auth/v1/user', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.currentSession.access_token}`,
        },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { error: new Error(body.msg || 'Password update failed') }
      }
      return { error: null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Password update failed') }
    }
  }

  getSession(): ForumlineSession | null {
    if (!this.currentSession) return null
    if (this.currentSession.expires_at * 1000 < Date.now()) {
      // Token expired — refresh will happen via timer, return null for now
      this.refreshSession()
      return null
    }
    return this.currentSession
  }

  async restoreSessionFromUrl(): Promise<boolean> {
    const hash = window.location.hash
    if (!hash) return false
    const params = new URLSearchParams(hash.substring(1))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (!accessToken || !refreshToken) return false

    try {
      const userRes = await fetch('/auth/v1/user', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      })
      if (!userRes.ok) return false
      const user = await userRes.json()

      const payload = JSON.parse(atob(accessToken.split('.')[1]))
      const session: ForumlineSession = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: (payload.exp - payload.iat) || 3600,
        expires_at: payload.exp || Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: user.id,
          email: user.email || '',
          user_metadata: user.user_metadata,
        },
      }
      this.saveSession(session)

      const type = params.get('type')
      if (type === 'recovery') {
        this.emit('PASSWORD_RECOVERY', session)
      } else {
        this.emit('SIGNED_IN', session)
      }
      window.history.replaceState({}, '', window.location.pathname)
      return true
    } catch {
      return false
    }
  }

  onAuthStateChange(callback: AuthCallback): Unsubscribe {
    this.listeners.add(callback)
    if (this.currentSession) {
      setTimeout(() => callback('INITIAL_SESSION', this.currentSession), 0)
    } else {
      setTimeout(() => callback('INITIAL_SESSION', null), 0)
    }
    return () => { this.listeners.delete(callback) }
  }
}
