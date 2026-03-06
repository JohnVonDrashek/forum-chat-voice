import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react'
import { CentralServicesClient } from '@johnvondrashek/forumline-central-services-client'

interface HubContextType {
  hubClient: CentralServicesClient | null
  hubUserId: string | null
  isHubConnected: boolean
  reconnect: () => void
}

const HubContext = createContext<HubContextType>({
  hubClient: null,
  hubUserId: null,
  isHubConnected: false,
  reconnect: () => {},
})

export function useHub() {
  return useContext(HubContext)
}

interface HubProviderProps {
  /** The current authenticated user, or null if logged out. */
  user: { id: string } | null
  /** Base URL of the hub API (e.g. 'https://app.forumline.net'). */
  hubUrl: string
  /** Endpoint to fetch the hub access token. Defaults to '/api/forumline/auth/hub-token'. */
  hubTokenEndpoint?: string
  /** Interval in ms to poll hub-token endpoint for revocation. Set to 0 to disable. Defaults to 30000. */
  heartbeatInterval?: number
  /**
   * Direct session for desktop app — bypasses the hub-token endpoint fetch.
   * When provided, uses the access token directly to create clients.
   */
  directSession?: { access_token: string; user_id: string } | null
  children: ReactNode
  /** @deprecated No longer used. Supabase has been removed from the hub. */
  hubSupabaseUrl?: string
  /** @deprecated No longer used. Supabase has been removed from the hub. */
  hubSupabaseAnonKey?: string
}

export function HubProvider({
  user,
  hubUrl,
  hubTokenEndpoint = '/api/forumline/auth/hub-token',
  heartbeatInterval = 30000,
  directSession,
  children,
}: HubProviderProps) {
  const [hubClient, setHubClient] = useState<CentralServicesClient | null>(null)
  const [hubUserId, setHubUserId] = useState<string | null>(null)
  const [isHubConnected, setIsHubConnected] = useState(false)
  const initRef = useRef(false)
  const lastTokenRef = useRef<string | null>(null)

  // When directSession token changes, update the client without full re-init
  useEffect(() => {
    if (!directSession || !isHubConnected) return
    if (directSession.access_token === lastTokenRef.current) return

    lastTokenRef.current = directSession.access_token
    const client = new CentralServicesClient(hubUrl, directSession.access_token)
    setHubClient(client)
  }, [directSession, isHubConnected, hubUrl])

  useEffect(() => {
    if (!user || initRef.current) return

    initRef.current = true

    const init = async () => {
      try {
        let token: string
        let userId: string | null = null

        if (directSession) {
          // Desktop app / hub: use the session token directly
          token = directSession.access_token
          userId = directSession.user_id
        } else {
          // Web forum: fetch the hub access token from our server-side cookie
          const res = await fetch(hubTokenEndpoint, { credentials: 'include' })
          const data = await res.json()

          if (!data.hub_access_token) {
            console.log('[FLD:Hub] No hub access token available — hub DMs disabled')
            return
          }

          token = data.hub_access_token
          userId = data.user_id || null
        }

        lastTokenRef.current = token

        // Create hub DM client
        const client = new CentralServicesClient(hubUrl, token)
        setHubClient(client)
        setHubUserId(userId)
        setIsHubConnected(true)
        console.log('[FLD:Hub] Connected to hub for cross-forum DMs')
      } catch (err) {
        console.error('[FLD:Hub] Failed to initialize hub connection:', err)
      }
    }

    init()
  }, [user, hubUrl, hubTokenEndpoint, directSession])

  const teardown = useCallback(() => {
    setHubClient(null)
    setHubUserId(null)
    setIsHubConnected(false)
  }, [])

  const reconnect = useCallback(() => {
    teardown()
    initRef.current = false
  }, [teardown])

  // Reset when user logs out
  useEffect(() => {
    if (!user) {
      reconnect()
    }
  }, [user, reconnect])

  // Heartbeat: poll hub-token endpoint to detect revocation
  // Skip when using directSession
  useEffect(() => {
    if (!isHubConnected || !user || !heartbeatInterval || directSession) return

    const id = setInterval(async () => {
      try {
        const res = await fetch(hubTokenEndpoint, { credentials: 'include' })
        const data = await res.json()
        if (!data.hub_access_token) {
          console.log('[FLD:Hub] Heartbeat detected hub revocation')
          teardown()
        }
      } catch {
        // Ignore network errors — don't tear down on transient failures
      }
    }, heartbeatInterval)

    return () => clearInterval(id)
  }, [isHubConnected, user, heartbeatInterval, hubTokenEndpoint, teardown, directSession])

  return (
    <HubContext.Provider value={{ hubClient, hubUserId, isHubConnected, reconnect }}>
      {children}
    </HubContext.Provider>
  )
}
