import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ForumProvider, HubProvider } from '@johnvondrashek/forumline-react'
import { VoiceProvider } from './lib/voice'
import { useUnreadReporter } from './hooks/useUnreadReporter'
import { useNotificationReporter } from './hooks/useNotificationReporter'
import ScrollToTop from './components/ScrollToTop'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Skeleton from './components/ui/Skeleton'
import { RequireAuth, RequireAdmin, RedirectIfAuth } from './components/RequireAuth'

// Lazy-load all pages for code splitting
const Home = lazy(() => import('./pages/Home'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Category = lazy(() => import('./pages/Category'))
const Thread = lazy(() => import('./pages/Thread'))
const NewThread = lazy(() => import('./pages/NewThread'))
const Profile = lazy(() => import('./pages/Profile'))
const Chat = lazy(() => import('./pages/Chat'))
const Search = lazy(() => import('./pages/Search'))
const Voice = lazy(() => import('./pages/Voice'))
const DirectMessages = lazy(() => import('./pages/DirectMessages'))
const Bookmarks = lazy(() => import('./pages/Bookmarks'))
const Settings = lazy(() => import('./pages/Settings'))
const Admin = lazy(() => import('./pages/Admin'))
const NotFound = lazy(() => import('./pages/NotFound'))

const HUB_SUPABASE_URL = import.meta.env.VITE_HUB_SUPABASE_URL as string
const HUB_SUPABASE_ANON_KEY = import.meta.env.VITE_HUB_SUPABASE_ANON_KEY as string
const HUB_URL = (import.meta.env.VITE_HUB_URL as string) || 'https://forumline-hub.vercel.app'

function PageFallback() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )
}

/** Bridges AuthProvider's user into HubProvider props. */
function AuthenticatedProviders({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  useUnreadReporter(user?.id ?? null)
  useNotificationReporter(user?.id ?? null)
  return (
    <ErrorBoundary>
      <HubProvider
        user={user}
        hubSupabaseUrl={HUB_SUPABASE_URL}
        hubSupabaseAnonKey={HUB_SUPABASE_ANON_KEY}
        hubUrl={HUB_URL}
      >
        <ForumProvider>
          <VoiceProvider>
            {children}
          </VoiceProvider>
        </ForumProvider>
      </HubProvider>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedProviders>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Suspense fallback={<PageFallback />}><Home /></Suspense>} />
          <Route path="login" element={<RedirectIfAuth><Suspense fallback={<PageFallback />}><Login /></Suspense></RedirectIfAuth>} />
          <Route path="register" element={<RedirectIfAuth><Suspense fallback={<PageFallback />}><Register /></Suspense></RedirectIfAuth>} />
          <Route path="forgot-password" element={<RedirectIfAuth><Suspense fallback={<PageFallback />}><ForgotPassword /></Suspense></RedirectIfAuth>} />
          <Route path="reset-password" element={<Suspense fallback={<PageFallback />}><ResetPassword /></Suspense>} />
          <Route path="c/:categorySlug" element={<Suspense fallback={<PageFallback />}><Category /></Suspense>} />
          <Route path="c/:categorySlug/new" element={<RequireAuth><Suspense fallback={<PageFallback />}><NewThread /></Suspense></RequireAuth>} />
          <Route path="t/:threadId" element={<Suspense fallback={<PageFallback />}><Thread /></Suspense>} />
          <Route path="u/:username" element={<Suspense fallback={<PageFallback />}><Profile /></Suspense>} />
          <Route path="chat" element={<Suspense fallback={<PageFallback />}><Chat /></Suspense>} />
          <Route path="chat/:channelId" element={<Suspense fallback={<PageFallback />}><Chat /></Suspense>} />
          <Route path="search" element={<Suspense fallback={<PageFallback />}><Search /></Suspense>} />
          <Route path="voice" element={<Suspense fallback={<PageFallback />}><Voice /></Suspense>} />
          <Route path="voice/:roomId" element={<Suspense fallback={<PageFallback />}><Voice /></Suspense>} />
          <Route path="dm" element={<RequireAuth><Suspense fallback={<PageFallback />}><DirectMessages /></Suspense></RequireAuth>} />
          <Route path="dm/:recipientId" element={<RequireAuth><Suspense fallback={<PageFallback />}><DirectMessages /></Suspense></RequireAuth>} />
          <Route path="bookmarks" element={<RequireAuth><Suspense fallback={<PageFallback />}><Bookmarks /></Suspense></RequireAuth>} />
          <Route path="settings" element={<RequireAuth><Suspense fallback={<PageFallback />}><Settings /></Suspense></RequireAuth>} />
          <Route path="admin" element={<RequireAdmin><Suspense fallback={<PageFallback />}><Admin /></Suspense></RequireAdmin>} />
          <Route path="*" element={<Suspense fallback={<PageFallback />}><NotFound /></Suspense>} />
        </Route>
      </Routes>
      </AuthenticatedProviders>
    </AuthProvider>
  )
}
