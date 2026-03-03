import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from './supabase'
import { uploadDefaultAvatar } from './avatars'
import type { Profile } from '../types/database'
import type { User } from '@supabase/supabase-js'

// Use configured site URL or fall back to current origin
const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin

interface AppUser {
  id: string
  email: string
  username?: string
  avatar?: string
  user_metadata?: {
    username?: string
  }
}

interface AuthContextType {
  user: AppUser | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, username: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  signInWithGitHub: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = async (userId: string): Promise<Profile | null> => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (data) setProfile(data)
    return data
  }

  const ensureProfile = async (supaUser: User): Promise<Profile | null> => {
    // Try to fetch existing profile first
    let prof = await fetchProfile(supaUser.id)
    if (prof) return prof

    // Profile doesn't exist — create it (covers missing DB trigger, OAuth, etc.)
    const username = supaUser.user_metadata?.username
      || supaUser.email?.split('@')[0]
      || `user_${supaUser.id.slice(0, 8)}`
    const displayName = supaUser.user_metadata?.display_name || username

    const { error } = await supabase.from('profiles').upsert({
      id: supaUser.id,
      username,
      display_name: displayName,
      avatar_url: supaUser.user_metadata?.avatar_url || null,
    }, { onConflict: 'id' })

    if (error) {
      console.error('Failed to create profile:', error.message)
      return null
    }

    // Generate and upload a default DiceBear avatar
    const avatarUrl = await uploadDefaultAvatar(supaUser.id, 'user')
    if (avatarUrl) {
      await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', supaUser.id)
    }

    // Fetch the newly created profile
    return fetchProfile(supaUser.id)
  }

  const toAppUser = (supaUser: User | null, prof?: Profile | null): AppUser | null => {
    if (!supaUser) return null
    return {
      id: supaUser.id,
      email: supaUser.email || '',
      username: prof?.username,
      avatar: prof?.avatar_url || undefined,
      user_metadata: {
        username: prof?.username || supaUser.user_metadata?.username,
      },
    }
  }

  useEffect(() => {
    // Check existing session
    console.log('[FCV:Auth] Checking existing session...')
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        console.log('[FCV:Auth] Session found, ensuring profile for user:', session.user.id)
        try {
          const prof = await ensureProfile(session.user)
          setUser(toAppUser(session.user, prof))
          console.log('[FCV:Auth] Profile loaded successfully:', prof?.username)
        } catch (err) {
          console.error('[FCV:Auth] Failed to ensure profile during init:', err)
          // Still set user even if profile fails, so app doesn't hang
          setUser(toAppUser(session.user, null))
        }
      } else {
        console.log('[FCV:Auth] No existing session')
      }
      setLoading(false)
      console.log('[FCV:Auth] Auth init complete, loading=false')
    }).catch((err) => {
      console.error('[FCV:Auth] getSession() failed:', err)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[FCV:Auth] Auth state changed:', event)
        if (session?.user) {
          try {
            const prof = await ensureProfile(session.user)
            setUser(toAppUser(session.user, prof))
          } catch (err) {
            console.error('[FCV:Auth] Failed to ensure profile on auth change:', err)
            setUser(toAppUser(session.user, null))
          }

          // Redirect to reset-password page on PASSWORD_RECOVERY event
          if (event === 'PASSWORD_RECOVERY') {
            window.location.href = '/reset-password'
          }
        } else {
          setUser(null)
          setProfile(null)
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? new Error(error.message) : null }
  }

  const signUp = async (email: string, password: string, username: string) => {
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

    return { error: null }
  }

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error('[FCV:Auth] signOut failed:', err)
    }
    setUser(null)
    setProfile(null)
  }

  const signInWithGitHub = async () => {
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: siteUrl },
      })
    } catch (err) {
      console.error('[FCV:Auth] GitHub OAuth failed:', err)
    }
  }

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/reset-password`,
    })
    return { error: error ? new Error(error.message) : null }
  }

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error: error ? new Error(error.message) : null }
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut, signInWithGitHub, resetPassword, updatePassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
