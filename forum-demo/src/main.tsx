import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { DataProviderProvider } from './lib/data-provider'
import { ApiForumDataProvider } from './lib/api-data-provider'
import { SupabaseAuthProvider } from './lib/supabase-auth-provider'
import './index.css'

console.log('[FLD:App] Starting Forumline Demo...')

// Initialize providers
const authProvider = new SupabaseAuthProvider()
const dataProvider = new ApiForumDataProvider(
  () => authProvider.getSession().then(s => s?.access_token ?? null)
)

// Create a client with sensible defaults
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't refetch on window focus by default (can be overridden per-query)
      refetchOnWindowFocus: false,
      // Retry failed requests twice with exponential backoff
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      // Default stale time of 30 seconds
      staleTime: 1000 * 30,
    },
    mutations: {
      onError: (error) => {
        console.error('[FLD:Mutation] Mutation failed:', error)
      },
    },
  },
})

// Global query cache error logging
queryClient.getQueryCache().subscribe((event) => {
  if (event.type === 'updated' && event.query.state.status === 'error') {
    console.error('[FLD:QueryCache] Query failed:', event.query.queryKey, event.query.state.error)
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DataProviderProvider value={dataProvider}>
        <BrowserRouter>
          <App authProvider={authProvider} />
        </BrowserRouter>
      </DataProviderProvider>
    </QueryClientProvider>
  </StrictMode>,
)
