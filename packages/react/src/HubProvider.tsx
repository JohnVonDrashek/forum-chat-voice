import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CentralServicesClient } from '@forumline/central-services-client'

interface HubContextType {
  hubClient: CentralServicesClient | null
  hubSupabase: SupabaseClient | null
  hubUserId: string | null
  isHubConnected: boolean
}

const HubContext = createContext<HubContextType>({
  hubClient: null,
  hubSupabase: null,
  hubUserId: null,
  isHubConnected: false,
})

export function useHub() {
  return useContext(HubContext)
}

interface HubProviderProps {
  /** The current authenticated user, or null if logged out. */
  user: { id: string } | null
  /** Supabase URL for the hub project (for Realtime subscriptions). */
  hubSupabaseUrl: string
  /** Supabase anon key for the hub project. */
  hubSupabaseAnonKey: string
  /** Base URL of the hub API (e.g. 'https://forumline-hub.vercel.app'). */
  hubUrl: string
  /** Endpoint to fetch the hub access token. Defaults to '/api/forumline/auth/hub-token'. */
  hubTokenEndpoint?: string
  children: ReactNode
}

export function HubProvider({
  user,
  hubSupabaseUrl,
  hubSupabaseAnonKey,
  hubUrl,
  hubTokenEndpoint = '/api/forumline/auth/hub-token',
  children,
}: HubProviderProps) {
  const [hubClient, setHubClient] = useState<CentralServicesClient | null>(null)
  const [hubSupabase, setHubSupabase] = useState<SupabaseClient | null>(null)
  const [hubUserId, setHubUserId] = useState<string | null>(null)
  const [isHubConnected, setIsHubConnected] = useState(false)
  const initRef = useRef(false)

  useEffect(() => {
    if (!user || initRef.current) return
    if (!hubSupabaseUrl || !hubSupabaseAnonKey) return

    initRef.current = true

    const init = async () => {
      try {
        // Fetch the hub access token from our server-side cookie
        const res = await fetch(hubTokenEndpoint, { credentials: 'include' })
        const data = await res.json()

        if (!data.hub_access_token) {
          console.log('[FLD:Hub] No hub access token available — hub DMs disabled')
          return
        }

        const token = data.hub_access_token

        // Create hub DM client
        const client = new CentralServicesClient(hubUrl, token)
        setHubClient(client)

        // Create hub Supabase client for Realtime
        const hubSb = createClient(hubSupabaseUrl, hubSupabaseAnonKey, {
          global: {
            headers: { Authorization: `Bearer ${token}` },
          },
        })
        setHubSupabase(hubSb)

        // Get the hub user ID from the token
        try {
          const { data: { user: hubUser } } = await hubSb.auth.getUser(token)
          if (hubUser) {
            setHubUserId(hubUser.id)
          }
        } catch {
          // If getUser fails, we can still use the client for API calls
        }

        setIsHubConnected(true)
        console.log('[FLD:Hub] Connected to hub for cross-forum DMs')
      } catch (err) {
        console.error('[FLD:Hub] Failed to initialize hub connection:', err)
      }
    }

    init()
  }, [user, hubSupabaseUrl, hubSupabaseAnonKey, hubUrl, hubTokenEndpoint])

  // Reset when user logs out
  useEffect(() => {
    if (!user) {
      setHubClient(null)
      setHubSupabase(null)
      setHubUserId(null)
      setIsHubConnected(false)
      initRef.current = false
    }
  }, [user])

  return (
    <HubContext.Provider value={{ hubClient, hubSupabase, hubUserId, isHubConnected }}>
      {children}
    </HubContext.Provider>
  )
}
