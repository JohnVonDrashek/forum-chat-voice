import { Outlet } from 'react-router-dom'
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import Header from './Header'
import Sidebar from './Sidebar'
import MobileSidebar from './MobileSidebar'
import ErrorBoundary from './ErrorBoundary'
import ForumRail from './ForumRail'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'
import { useNativeNotifications } from '../hooks/useNativeNotifications'

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { user } = useAuth()
  useNativeNotifications()
  const [unreadDmCount, setUnreadDmCount] = useState(0)
  const queryClient = useQueryClient()

  // Use React Query for sidebar data - cached globally, instant on tab switch!
  const { data: categories = [], isError: categoriesError } = useQuery({
    queryKey: queryKeys.categories,
    queryFn: fetchers.categories,
    ...queryOptions.static,
  })

  const { data: channels = [], isError: channelsError } = useQuery({
    queryKey: queryKeys.channels,
    queryFn: fetchers.channels,
    ...queryOptions.static,
  })

  const { data: rooms = [], isError: roomsError } = useQuery({
    queryKey: queryKeys.voiceRooms,
    queryFn: fetchers.voiceRooms,
    ...queryOptions.static,
  })

  // Log sidebar data errors to console for diagnostics
  useEffect(() => {
    if (categoriesError) console.error('[FCV:Layout] Failed to load categories')
    if (channelsError) console.error('[FCV:Layout] Failed to load chat channels')
    if (roomsError) console.error('[FCV:Layout] Failed to load voice rooms')
  }, [categoriesError, channelsError, roomsError])

  // Prefetch common data in background on app load
  useEffect(() => {
    // Prefetch home page threads
    queryClient.prefetchQuery({
      queryKey: queryKeys.threads(20),
      queryFn: () => fetchers.threads(20),
      ...queryOptions.threads,
    })
  }, [queryClient])

  // Prefetch bookmarks once user is known
  useEffect(() => {
    if (!user) return
    queryClient.prefetchQuery({
      queryKey: queryKeys.bookmarks(user.id),
      queryFn: () => fetchers.bookmarksWithMeta(user.id),
      ...queryOptions.threads,
    })
  }, [user, queryClient])

  // Prefetch all category threads once categories are loaded
  useEffect(() => {
    if (categories.length === 0) return

    categories.forEach((category) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.threadsByCategory(category.slug),
        queryFn: () => fetchers.threadsByCategory(category.slug),
        ...queryOptions.threads,
      })
      // Also prefetch the category metadata
      queryClient.prefetchQuery({
        queryKey: queryKeys.category(category.slug),
        queryFn: () => fetchers.category(category.slug),
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
        queryFn: () => fetchers.chatMessagesBySlug(channel.slug),
        ...queryOptions.realtime,
      })
    })
  }, [channels, queryClient])

  useEffect(() => {
    if (!user) {
      setUnreadDmCount(0)
      return
    }

    const fetchUnread = async () => {
      const { count, error } = await supabase
        .from('direct_messages')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .eq('read', false)
      if (error) {
        console.error('[FCV:Layout] Failed to fetch unread DM count:', error)
        return
      }
      setUnreadDmCount(count ?? 0)
    }

    fetchUnread()

    // Subscribe to new DMs to update unread badge in real-time
    const sub = supabase
      .channel('layout-dm-unread')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${user.id}` },
        () => fetchUnread()
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [user])

  const handleMenuClick = useCallback(() => {
    setMobileMenuOpen(true)
  }, [])

  const handleMenuClose = useCallback(() => {
    setMobileMenuOpen(false)
  }, [])

  return (
    <div className="flex min-h-screen min-h-[100dvh]">
      {/* Forum rail — only visible in Tauri desktop app */}
      <ForumRail />

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

        {/* Mobile sidebar */}
        <MobileSidebar
          isOpen={mobileMenuOpen}
          onClose={handleMenuClose}
          categories={categories}
          channels={channels}
          rooms={rooms}
          unreadDmCount={unreadDmCount}
        />

        <div className="flex">
          <Sidebar
            categories={categories}
            channels={channels}
            rooms={rooms}
            unreadDmCount={unreadDmCount}
          />
          <main id="main-content" role="main" className="flex-1 p-4 sm:p-6">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  )
}
