import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CentralServicesClient } from '@johnvondrashek/forumline-central-services-client'
import { createStore, type Store } from './store.js'

export interface HubState {
  hubClient: CentralServicesClient | null
  hubSupabase: SupabaseClient | null
  hubUserId: string | null
  isHubConnected: boolean
}

export interface HubStoreOptions {
  hubSupabaseUrl: string
  hubSupabaseAnonKey: string
  hubUrl: string
  hubTokenEndpoint?: string
  heartbeatInterval?: number
}

export interface HubStore extends Store<HubState> {
  init: (session: { access_token: string; user_id: string }) => Promise<void>
  teardown: () => void
  destroy: () => void
}

export function createHubStore(options: HubStoreOptions): HubStore {
  const {
    hubSupabaseUrl,
    hubSupabaseAnonKey,
    hubUrl,
    heartbeatInterval = 30000,
  } = options

  const store = createStore<HubState>({
    hubClient: null,
    hubSupabase: null,
    hubUserId: null,
    isHubConnected: false,
  })

  let heartbeatId: ReturnType<typeof setInterval> | null = null

  function teardown() {
    if (heartbeatId) {
      clearInterval(heartbeatId)
      heartbeatId = null
    }
    store.set({
      hubClient: null,
      hubSupabase: null,
      hubUserId: null,
      isHubConnected: false,
    })
  }

  async function init(session: { access_token: string; user_id: string }) {
    try {
      const token = session.access_token

      const client = new CentralServicesClient(hubUrl, token)
      const hubSb = hubSupabaseUrl
        ? createClient(hubSupabaseUrl, hubSupabaseAnonKey, {
            global: {
              headers: { Authorization: `Bearer ${token}` },
            },
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              storageKey: 'forumline-hub-store',
            },
          })
        : null

      store.set({
        hubClient: client,
        hubSupabase: hubSb,
        hubUserId: session.user_id,
        isHubConnected: true,
      })

      console.log('[FLD:Hub] Connected to hub for cross-forum DMs')
    } catch (err) {
      console.error('[FLD:Hub] Failed to initialize hub connection:', err)
    }
  }

  function destroy() {
    teardown()
  }

  return {
    ...store,
    init,
    teardown,
    destroy,
  }
}
