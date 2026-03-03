import { Outlet } from 'react-router-dom'
import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import Header from './Header'
import Sidebar from './Sidebar'
import MobileSidebar from './MobileSidebar'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { user } = useAuth()
  const [unreadDmCount, setUnreadDmCount] = useState(0)

  // Use React Query for sidebar data - cached globally, instant on tab switch!
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories,
    queryFn: fetchers.categories,
    ...queryOptions.static,
  })

  const { data: channels = [] } = useQuery({
    queryKey: queryKeys.channels,
    queryFn: fetchers.channels,
    ...queryOptions.static,
  })

  const { data: rooms = [] } = useQuery({
    queryKey: queryKeys.voiceRooms,
    queryFn: fetchers.voiceRooms,
    ...queryOptions.static,
  })

  useEffect(() => {
    if (!user) {
      setUnreadDmCount(0)
      return
    }

    const fetchUnread = async () => {
      const { count } = await supabase
        .from('direct_messages')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .eq('read', false)
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
    <div className="min-h-screen bg-slate-900">
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
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
