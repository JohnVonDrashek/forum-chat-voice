import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { HubDmClient } from './hub-dm-client'
import { useAuth } from './auth'

interface HubContextType {
  hubClient: HubDmClient | null
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

const HUB_SUPABASE_URL = import.meta.env.VITE_HUB_SUPABASE_URL as string
const HUB_SUPABASE_ANON_KEY = import.meta.env.VITE_HUB_SUPABASE_ANON_KEY as string

export function HubProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [hubClient, setHubClient] = useState<HubDmClient | null>(null)
  const [hubSupabase, setHubSupabase] = useState<SupabaseClient | null>(null)
  const [hubUserId, setHubUserId] = useState<string | null>(null)
  const [isHubConnected, setIsHubConnected] = useState(false)
  const initRef = useRef(false)

  useEffect(() => {
    if (!user || initRef.current) return
    if (!HUB_SUPABASE_URL || !HUB_SUPABASE_ANON_KEY) return

    initRef.current = true

    const init = async () => {
      try {
        // Fetch the hub access token from our server-side cookie
        const res = await fetch('/api/forumline/auth/hub-token', { credentials: 'include' })
        const data = await res.json()

        if (!data.hub_access_token) {
          console.log('[FLD:Hub] No hub access token available — hub DMs disabled')
          return
        }

        const token = data.hub_access_token

        // Create hub DM client
        const client = new HubDmClient(token)
        setHubClient(client)

        // Create hub Supabase client for Realtime
        const hubSb = createClient(HUB_SUPABASE_URL, HUB_SUPABASE_ANON_KEY, {
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
  }, [user])

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
