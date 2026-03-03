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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: username },
      },
    })
    if (error) return { error: new Error(error.message) }

    // Create profile immediately (don't rely solely on DB trigger)
    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: data.user.id,
        username,
        display_name: username,
      }, { onConflict: 'id' })

      if (profileError) {
        return { error: new Error(profileError.message) }
      }
    }

    return { error: null, userId: data.user?.id }
  }

  async signOut(): Promise<void> {
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error('[Forumline:Auth] signOut failed:', err)
    }
  }

  async signInWithOAuth(provider: string): Promise<void> {
    try {
      await supabase.auth.signInWithOAuth({
        provider: provider as 'github',
        options: { redirectTo: siteUrl },
      })
    } catch (err) {
      console.error(`[Forumline:Auth] ${provider} OAuth failed:`, err)
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
