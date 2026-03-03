import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from './supabase'
import { uploadDefaultAvatar } from './avatars'
import type { Profile } from '../types/database'
import type { User } from '@supabase/supabase-js'

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
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const prof = await ensureProfile(session.user)
        setUser(toAppUser(session.user, prof))
      }
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          const prof = await ensureProfile(session.user)
          setUser(toAppUser(session.user, prof))
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
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  const signInWithGitHub = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin },
    })
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut, signInWithGitHub }}>
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
