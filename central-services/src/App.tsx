import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createClient, type Session } from '@supabase/supabase-js'
import { ForumProvider, HubProvider } from '@johnvondrashek/forumline-react'
import AppLayout from './components/AppLayout'

const hubSupabaseUrl = import.meta.env.VITE_HUB_SUPABASE_URL
const hubSupabaseAnonKey = import.meta.env.VITE_HUB_SUPABASE_ANON_KEY

// Hub Supabase client — authenticates directly with the hub (same-origin)
const hubSupabase = createClient(hubSupabaseUrl, hubSupabaseAnonKey)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

export { hubSupabase }

export default function App() {
  const [hubSession, setHubSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    hubSupabase.auth.getSession().then(({ data: { session } }) => {
      setHubSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = hubSupabase.auth.onAuthStateChange((_event, session) => {
      setHubSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-500" />
      </div>
    )
  }

  const directSession = hubSession
    ? { access_token: hubSession.access_token, user_id: hubSession.user.id }
    : null

  return (
    <QueryClientProvider client={queryClient}>
      <HubProvider
        user={hubSession ? { id: hubSession.user.id } : null}
        hubSupabaseUrl={hubSupabaseUrl}
        hubSupabaseAnonKey={hubSupabaseAnonKey}
        hubUrl=""
        directSession={directSession}
      >
        <ForumProvider>
          <AppLayout hubSession={hubSession} />
        </ForumProvider>
      </HubProvider>
    </QueryClientProvider>
  )
}
