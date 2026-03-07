import { CentralServicesClient } from '@johnvondrashek/forumline-central-services-client'
import { createStore, type Store } from './store.js'

export interface ForumlineState {
  forumlineClient: CentralServicesClient | null
  forumlineUserId: string | null
  isForumlineConnected: boolean
}

export interface ForumlineStoreOptions {
  forumlineUrl: string
  forumlineTokenEndpoint?: string
  heartbeatInterval?: number
}

export interface ForumlineStore extends Store<ForumlineState> {
  init: (session: { access_token: string; user_id: string }) => Promise<void>
  teardown: () => void
  destroy: () => void
}

export function createForumlineStore(options: ForumlineStoreOptions): ForumlineStore {
  const {
    forumlineUrl,
    heartbeatInterval = 30000,
  } = options

  const store = createStore<ForumlineState>({
    forumlineClient: null,
    forumlineUserId: null,
    isForumlineConnected: false,
  })

  let heartbeatId: ReturnType<typeof setInterval> | null = null

  function teardown() {
    if (heartbeatId) {
      clearInterval(heartbeatId)
      heartbeatId = null
    }
    store.set({
      forumlineClient: null,
      forumlineUserId: null,
      isForumlineConnected: false,
    })
  }

  async function init(session: { access_token: string; user_id: string }) {
    try {
      const token = session.access_token

      const client = new CentralServicesClient(forumlineUrl, token)

      store.set({
        forumlineClient: client,
        forumlineUserId: session.user_id,
        isForumlineConnected: true,
      })

      console.log('[FLD:Forumline] Connected to Forumline for cross-forum DMs')
    } catch (err) {
      console.error('[FLD:Forumline] Failed to initialize Forumline connection:', err)
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
