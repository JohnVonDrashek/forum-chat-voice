import { Outlet } from 'react-router-dom'
import { useState, useCallback, useEffect } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import MobileSidebar from './MobileSidebar'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Category, ChatChannel, VoiceRoom } from '../types'

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { user } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<ChatChannel[]>([])
  const [rooms, setRooms] = useState<VoiceRoom[]>([])
  const [unreadDmCount, setUnreadDmCount] = useState(0)

  useEffect(() => {
    const fetchData = async () => {
      const [catRes, chanRes, roomRes] = await Promise.all([
        supabase.from('categories').select('*').order('sort_order'),
        supabase.from('chat_channels').select('*').order('name'),
        supabase.from('voice_rooms').select('*').order('name'),
      ])
      if (catRes.data) setCategories(catRes.data)
      if (chanRes.data) setChannels(chanRes.data)
      if (roomRes.data) setRooms(roomRes.data)
    }

    fetchData()
  }, [])

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
