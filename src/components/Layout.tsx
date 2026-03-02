import { Outlet } from 'react-router-dom'
import { useState, useCallback, useEffect } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import MobileSidebar from './MobileSidebar'
import { supabase, isConfigured } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Category, ChatChannel, VoiceRoom } from '../types'

// Demo data shared between sidebars
const demoCategories: Category[] = [
  { id: '1', name: 'General', slug: 'general', description: 'General discussion', sort_order: 0, created_at: '' },
  { id: '2', name: 'Announcements', slug: 'announcements', description: 'Official announcements', sort_order: 1, created_at: '' },
  { id: '3', name: 'Help & Support', slug: 'help', description: 'Get help from the community', sort_order: 2, created_at: '' },
  { id: '4', name: 'Showcase', slug: 'showcase', description: 'Show off your projects', sort_order: 3, created_at: '' },
]

const demoChannels: ChatChannel[] = [
  { id: 'general', name: 'general', slug: 'general', description: null, created_at: '' },
  { id: 'random', name: 'random', slug: 'random', description: null, created_at: '' },
  { id: 'introductions', name: 'introductions', slug: 'introductions', description: null, created_at: '' },
  { id: 'help', name: 'help', slug: 'help', description: null, created_at: '' },
]

const demoRooms: VoiceRoom[] = [
  { id: 'lounge', name: 'Lounge', slug: 'lounge', created_at: '' },
  { id: 'gaming', name: 'Gaming', slug: 'gaming', created_at: '' },
  { id: 'music', name: 'Music', slug: 'music', created_at: '' },
  { id: 'study', name: 'Study Room', slug: 'study', created_at: '' },
]

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { user } = useAuth()
  const [categories, setCategories] = useState<Category[]>(demoCategories)
  const [channels, setChannels] = useState<ChatChannel[]>(demoChannels)
  const [rooms, setRooms] = useState<VoiceRoom[]>(demoRooms)
  const [unreadDmCount, setUnreadDmCount] = useState(isConfigured ? 0 : 2)

  useEffect(() => {
    if (!isConfigured) return

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
    if (!isConfigured || !user) {
      if (isConfigured) setUnreadDmCount(0)
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
