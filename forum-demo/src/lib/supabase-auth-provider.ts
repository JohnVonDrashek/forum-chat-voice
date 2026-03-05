/**
 * SupabaseAuthProvider — Supabase implementation of ForumAuthProvider.
 */

import { supabase } from './supabase'
import type {
  ForumAuthProvider,
  AuthSession,
  AuthCallback,
  AuthStateEvent,
  Unsubscribe,
} from './auth-provider'

// Use configured site URL or fall back to current origin
const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin

export class SupabaseAuthProvider implements ForumAuthProvider {
  async signIn(email: string, password: string): Promise<{ error: Error | null }> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? new Error(error.message) : null }
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

      // Set the session returned by the server
      if (body.session?.access_token && body.session?.refresh_token) {
        await supabase.auth.setSession({
          access_token: body.session.access_token,
          refresh_token: body.session.refresh_token,
        })
      }

      return { error: null, userId: body.user?.id }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Signup failed') }
    }
  }

  async signOut(): Promise<void> {
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error('[Forumline:Auth] signOut failed:', err)
    }
  }

  async resetPassword(email: string): Promise<{ error: Error | null }> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/reset-password`,
    })
    return { error: error ? new Error(error.message) : null }
  }

  async updatePassword(newPassword: string): Promise<{ error: Error | null }> {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error: error ? new Error(error.message) : null }
  }

  async getSession(): Promise<AuthSession | null> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return null
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

  async getRawUser(): Promise<{ id: string; email?: string; user_metadata?: Record<string, unknown> } | null> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return null
    return {
      id: session.user.id,
      email: session.user.email,
      user_metadata: session.user.user_metadata,
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
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (error) {
      console.error('[FLD:Auth] Failed to set session from hash:', error)
      return false
    }
    console.log('[FLD:Auth] Session set from URL hash')
    // Clear hash from URL
    window.history.replaceState({}, '', window.location.pathname)
    return true
  }

  onAuthStateChange(callback: AuthCallback): Unsubscribe {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const mappedEvent = event as AuthStateEvent
        if (!session?.user) {
          callback(mappedEvent, null)
          return
        }
        callback(mappedEvent, {
          access_token: session.access_token,
          user: {
            id: session.user.id,
            email: session.user.email || '',
            user_metadata: {
              username: session.user.user_metadata?.username as string | undefined,
            },
          },
        })
      }
    )
    return () => subscription.unsubscribe()
  }
}
