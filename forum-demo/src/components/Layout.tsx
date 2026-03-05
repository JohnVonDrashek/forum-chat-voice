import { Outlet } from 'react-router-dom'
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import Header from './Header'
import Sidebar from './Sidebar'
import MobileSidebar from './MobileSidebar'
import ErrorBoundary from './ErrorBoundary'
import { ForumWebview, useForum, useNativeNotifications } from '@johnvondrashek/forumline-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { queryKeys, queryOptions } from '../lib/queries'
import { useDataProvider } from '../lib/data-provider'

export default function Layout() {
  const dp = useDataProvider()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { user } = useAuth()
  const { activeForum } = useForum()
  useNativeNotifications(user, supabase)
  const queryClient = useQueryClient()

  // Use React Query for sidebar data - cached globally, instant on tab switch!
  const { data: categories = [], isError: categoriesError } = useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => dp.getCategories(),
    ...queryOptions.static,
  })

  const { data: channels = [], isError: channelsError } = useQuery({
    queryKey: queryKeys.channels,
    queryFn: () => dp.getChannels(),
    ...queryOptions.static,
  })

  const { data: rooms = [], isError: roomsError } = useQuery({
    queryKey: queryKeys.voiceRooms,
    queryFn: () => dp.getVoiceRooms(),
    ...queryOptions.static,
  })

  // Log sidebar data errors to console for diagnostics
  useEffect(() => {
    if (categoriesError) console.error('[FLD:Layout] Failed to load categories')
    if (channelsError) console.error('[FLD:Layout] Failed to load chat channels')
    if (roomsError) console.error('[FLD:Layout] Failed to load voice rooms')
  }, [categoriesError, channelsError, roomsError])

  // Prefetch common data in background on app load
  useEffect(() => {
    // Prefetch home page threads
    queryClient.prefetchQuery({
      queryKey: queryKeys.threads(20),
      queryFn: () => dp.getThreads(20),
      ...queryOptions.threads,
    })
  }, [queryClient])

  // Prefetch bookmarks once user is known
  useEffect(() => {
    if (!user) return
    queryClient.prefetchQuery({
      queryKey: queryKeys.bookmarks(user.id),
      queryFn: () => dp.getBookmarksWithMeta(user.id),
      ...queryOptions.threads,
    })
  }, [user, queryClient])

  // Prefetch all category threads once categories are loaded
  useEffect(() => {
    if (categories.length === 0) return

    categories.forEach((category) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.threadsByCategory(category.slug),
        queryFn: () => dp.getThreadsByCategory(category.slug),
        ...queryOptions.threads,
      })
      // Also prefetch the category metadata
      queryClient.prefetchQuery({
        queryKey: queryKeys.category(category.slug),
        queryFn: () => dp.getCategory(category.slug),
        ...queryOptions.static,
      })
    })
  }, [categories, queryClient])

  // Prefetch all chat channel messages once channels are loaded
  useEffect(() => {
    if (channels.length === 0) return

    channels.forEach((channel) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.chatMessages(channel.slug),
        queryFn: () => dp.getChatMessages(channel.slug),
        ...queryOptions.realtime,
      })
    })
  }, [channels, queryClient])

  const handleMenuClick = useCallback(() => {
    setMobileMenuOpen(true)
  }, [])

  const handleMenuClose = useCallback(() => {
    setMobileMenuOpen(false)
  }, [])

  return (
    <div className="flex min-h-screen min-h-[100dvh]">
      <div className="flex-1 bg-slate-900">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          Skip to main content
        </a>
        <Toaster position="bottom-right" toastOptions={{
          style: { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' },
          success: { iconTheme: { primary: '#22c55e', secondary: '#f1f5f9' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#f1f5f9' } },
        }} />
        <Header onMenuClick={handleMenuClick} />

        {activeForum ? (
          /* External forum loaded in iframe */
          <ForumWebview forum={activeForum} />
        ) : (
          <>
            {/* Mobile sidebar */}
            <MobileSidebar
              isOpen={mobileMenuOpen}
              onClose={handleMenuClose}
              categories={categories}
              channels={channels}
              rooms={rooms}
            />

            <div className="flex">
              <Sidebar
                categories={categories}
                channels={channels}
                rooms={rooms}
                />
              <main id="main-content" role="main" className="flex-1 p-4 sm:p-6">
                <ErrorBoundary>
                  <Outlet />
                </ErrorBoundary>
              </main>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
