import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { getAuthProvider, type AppUser } from './auth-provider'
import { getDataProvider } from './data-provider'
import { uploadDefaultAvatar } from './avatars'
import { supabase } from './supabase'
import type { Profile } from '../types/database'
import type { ForumToHubMessage, HubToForumMessage } from '@johnvondrashek/forumline-protocol'

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
  // Track which user ID getSession() already loaded so onAuthStateChange
  // can skip redundant ensureProfile calls for the same user.
  const loadedUserIdRef = useRef<string | null>(null)
  // Store the parent frame's origin for secure postMessage targeting
  const parentOriginRef = useRef<string | null>(null)

  const fetchProfile = async (userId: string): Promise<Profile | null> => {
    const data = await getDataProvider().getProfile(userId)
    if (data) setProfile(data)
    return data
  }

  const ensureProfile = async (rawUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }): Promise<Profile | null> => {
    // Try to fetch existing profile first
    let prof = await fetchProfile(rawUser.id)
    if (prof) return prof

    // Profile doesn't exist — create it
    const username = (rawUser.user_metadata?.username as string)
      || rawUser.email?.split('@')[0]
      || `user_${rawUser.id.slice(0, 8)}`
    const displayName = (rawUser.user_metadata?.display_name as string) || username

    try {
      await getDataProvider().upsertProfile(rawUser.id, {
        username,
        display_name: displayName,
        avatar_url: (rawUser.user_metadata?.avatar_url as string) || null,
      })
    } catch (error) {
      console.error('Failed to create profile:', error)
      return null
    }

    // Generate and upload a default DiceBear avatar
    const avatarUrl = await uploadDefaultAvatar(rawUser.id, 'user')
    if (avatarUrl) {
      await getDataProvider().updateProfile(rawUser.id, { avatar_url: avatarUrl })
    }

    // Fetch the newly created profile
    return fetchProfile(rawUser.id)
  }

  const toAppUser = (rawUser: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null, prof?: Profile | null): AppUser | null => {
    if (!rawUser) return null
    return {
      id: rawUser.id,
      email: rawUser.email || '',
      username: prof?.username,
      avatar: prof?.avatar_url || undefined,
      user_metadata: {
        username: prof?.username || (rawUser.user_metadata?.username as string | undefined),
      },
    }
  }

  const postToParent = (msg: ForumToHubMessage) => {
    if (window.parent === window) return
    const targetOrigin = parentOriginRef.current || '*'
    window.parent.postMessage(msg, targetOrigin)
  }

  useEffect(() => {
    const auth = getAuthProvider()

    // Detect session tokens from URL hash (e.g. after Forumline OAuth redirect).
    // Supabase PKCE flow doesn't auto-detect hash fragments, so we handle it manually.
    const initSession = async () => {
      const hash = window.location.hash
      if (hash) {
        const params = new URLSearchParams(hash.substring(1))
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')
        if (accessToken && refreshToken) {
          console.log('[FLD:Auth] Detected session tokens in URL hash, setting session...')
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (error) {
            console.error('[FLD:Auth] Failed to set session from hash:', error)
          } else {
            console.log('[FLD:Auth] Session set from URL hash')
          }
          // Clear hash from URL
          window.history.replaceState({}, '', window.location.pathname)
        }
      }
    }

    // Check existing session (after handling any hash tokens)
    console.log('[FLD:Auth] Checking existing session...')
    initSession().then(() => auth.getRawUser()).then(async (rawUser) => {
      if (rawUser) {
        console.log('[FLD:Auth] Session found, ensuring profile for user:', rawUser.id)
        try {
          const prof = await ensureProfile(rawUser)
          setUser(toAppUser(rawUser, prof))
          loadedUserIdRef.current = rawUser.id
          console.log('[FLD:Auth] Profile loaded successfully:', prof?.username)
        } catch (err) {
          console.error('[FLD:Auth] Failed to ensure profile during init:', err)
          // Still set user even if profile fails, so app doesn't hang
          setUser(toAppUser(rawUser, null))
          loadedUserIdRef.current = rawUser.id
        }
      } else {
        console.log('[FLD:Auth] No existing session')
      }
      setLoading(false)
      console.log('[FLD:Auth] Auth init complete, loading=false')

      // Notify parent frame (hub) of auth state
      postToParent({ type: 'forumline:auth_state', signedIn: !!rawUser })
    }).catch((err) => {
      console.error('[FLD:Auth] getSession() failed:', err)
      setLoading(false)
    })

    // Listen for auth changes
    const unsubscribe = auth.onAuthStateChange(
      async (event, session) => {
        console.log('[FLD:Auth] Auth state changed:', event, session?.user?.id ?? '(no user)')

        // INITIAL_SESSION is fully handled by getRawUser() above — always skip.
        if (event === 'INITIAL_SESSION') {
          console.log('[FLD:Auth] INITIAL_SESSION handled by getRawUser, skipping')
          return
        }

        // For SIGNED_IN and TOKEN_REFRESHED: if we already loaded this exact
        // user, skip the redundant ensureProfile + setUser.
        if (
          (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
          session?.user &&
          session.user.id === loadedUserIdRef.current
        ) {
          console.log('[FLD:Auth] Skipping redundant', event, 'for already-loaded user:', session.user.id)
          return
        }

        if (session?.user) {
          console.log('[FLD:Auth] New/changed user, loading profile:', session.user.id)
          // Get the raw user with full metadata
          const rawUser = await auth.getRawUser()
          if (!rawUser) return
          try {
            const prof = await ensureProfile(rawUser)
            setUser(toAppUser(rawUser, prof))
            loadedUserIdRef.current = rawUser.id
          } catch (err) {
            console.error('[FLD:Auth] Failed to ensure profile on auth change:', err)
            setUser(toAppUser(rawUser, null))
            loadedUserIdRef.current = rawUser.id
          }

          // Notify parent frame (hub) of sign-in
          postToParent({ type: 'forumline:auth_state', signedIn: true })

          // Redirect to reset-password page on PASSWORD_RECOVERY event
          if (event === 'PASSWORD_RECOVERY') {
            window.location.href = '/reset-password'
          }
        } else {
          // Signed out or session expired
          console.log('[FLD:Auth] User signed out, clearing state')
          setUser(null)
          setProfile(null)
          loadedUserIdRef.current = null

          // Notify parent frame (hub) of sign-out
          postToParent({ type: 'forumline:auth_state', signedIn: false })
        }
      }
    )

    // Listen for requests from parent frame (hub)
    const handleHubMessage = (event: MessageEvent) => {
      if (window.parent === window) return
      const msg = event.data as HubToForumMessage
      if (!msg?.type?.startsWith('forumline:')) return

      parentOriginRef.current = event.origin

      switch (msg.type) {
        case 'forumline:request_auth_state':
          window.parent.postMessage(
            { type: 'forumline:auth_state', signedIn: !!loadedUserIdRef.current } satisfies ForumToHubMessage,
            event.origin,
          )
          break
        case 'forumline:request_unread_counts':
          break
      }
    }
    window.addEventListener('message', handleHubMessage)

    // Signal to parent that the forum is ready to receive messages
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'forumline:ready' }, '*')
    }

    return () => {
      unsubscribe()
      window.removeEventListener('message', handleHubMessage)
    }
  }, [])

  // Strip ?forumline_auth=success from URL after Supabase picks up session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('forumline_auth')) {
      params.delete('forumline_auth')
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname
      window.history.replaceState({}, '', newUrl)
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    return getAuthProvider().signIn(email, password)
  }

  const signUp = async (email: string, password: string, username: string) => {
    return getAuthProvider().signUp(email, password, username)
  }

  const signOut = async () => {
    await getAuthProvider().signOut()
    setUser(null)
    setProfile(null)
    loadedUserIdRef.current = null
  }

  const signInWithGitHub = async () => {
    await getAuthProvider().signInWithOAuth('github')
  }

  const resetPassword = async (email: string) => {
    return getAuthProvider().resetPassword(email)
  }

  const updatePassword = async (newPassword: string) => {
    return getAuthProvider().updatePassword(newPassword)
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
