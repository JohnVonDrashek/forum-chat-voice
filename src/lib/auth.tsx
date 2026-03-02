import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase, isConfigured } from './supabase'
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
    if (!isConfigured) {
      setLoading(false)
      return
    }

    // Check existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const prof = await fetchProfile(session.user.id)
        setUser(toAppUser(session.user, prof))
      }
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          const prof = await fetchProfile(session.user.id)
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
    if (!isConfigured) return { error: new Error('Supabase not configured') }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? new Error(error.message) : null }
  }

  const signUp = async (email: string, password: string, username: string) => {
    if (!isConfigured) return { error: new Error('Supabase not configured') }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: username },
      },
    })
    return { error: error ? new Error(error.message) : null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  const signInWithGitHub = async () => {
    if (!isConfigured) return

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
