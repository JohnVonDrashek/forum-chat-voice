import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { ForumProvider } from './lib/forum'
import { HubProvider } from './lib/hub-context'
import { VoiceProvider } from './lib/voice'
import ScrollToTop from './components/ScrollToTop'
import Layout from './components/Layout'
import Skeleton from './components/ui/Skeleton'
import { RequireAuth, RequireAdmin } from './components/RequireAuth'

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

export default function App() {
  return (
    <AuthProvider>
      <HubProvider>
      <ForumProvider>
      <VoiceProvider>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Suspense fallback={<PageFallback />}><Home /></Suspense>} />
          <Route path="login" element={<Suspense fallback={<PageFallback />}><Login /></Suspense>} />
          <Route path="register" element={<Suspense fallback={<PageFallback />}><Register /></Suspense>} />
          <Route path="forgot-password" element={<Suspense fallback={<PageFallback />}><ForgotPassword /></Suspense>} />
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
        </Route>
      </Routes>
      </VoiceProvider>
      </ForumProvider>
      </HubProvider>
    </AuthProvider>
  )
}
