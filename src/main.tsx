import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { setDataProvider } from './lib/data-provider'
import { SupabaseForumDataProvider } from './lib/supabase-data-provider'
import { setAuthProvider } from './lib/auth-provider'
import { SupabaseAuthProvider } from './lib/supabase-auth-provider'
import './index.css'

console.log('[FCV:App] Starting Forum Chat Voice...')

// Initialize providers
setDataProvider(new SupabaseForumDataProvider())
setAuthProvider(new SupabaseAuthProvider())

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
        console.error('[FCV:Mutation] Mutation failed:', error)
      },
    },
  },
})

// Global query cache error logging
queryClient.getQueryCache().subscribe((event) => {
  if (event.type === 'updated' && event.query.state.status === 'error') {
    console.error('[FCV:QueryCache] Query failed:', event.query.queryKey, event.query.state.error)
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
