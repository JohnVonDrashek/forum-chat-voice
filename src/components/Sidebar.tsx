import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase, isConfigured } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Category, ChatChannel, VoiceRoom } from '../types'

// Demo data when Supabase is not configured
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

export default function Sidebar() {
  const location = useLocation()
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

  // Fetch unread DM count for logged-in users
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

    // Subscribe to new DMs for unread count
    const sub = supabase
      .channel('sidebar-dm-count')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${user.id}` },
        () => fetchUnread()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${user.id}` },
        () => fetchUnread()
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [user])

  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 border-r border-slate-700 bg-slate-800/50 lg:block">
      <nav className="h-full overflow-y-auto p-4">
        <div className="mb-4 space-y-1">
          <Link
            to="/"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              location.pathname === '/'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Home
          </Link>
          <Link
            to="/bookmarks"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              location.pathname === '/bookmarks'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            Bookmarks
          </Link>
          <Link
            to="/settings"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              location.pathname === '/settings'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </Link>
        </div>

        <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Categories
        </div>
        <div className="space-y-1">
          {categories.map((category) => {
            const isActive = location.pathname === `/c/${category.slug}`
            return (
              <Link
                key={category.id}
                to={`/c/${category.slug}`}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-indigo-400" />
                {category.name}
              </Link>
            )
          })}
        </div>

        {/* Chat Channels */}
        <div className="mt-6 mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Chat Channels
        </div>
        <div className="space-y-1">
          {channels.map((channel) => {
            const isActive = location.pathname === `/chat/${channel.slug}`
            return (
              <Link
                key={channel.id}
                to={`/chat/${channel.slug}`}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                }`}
              >
                <span className="text-green-400">#</span>
                {channel.name}
              </Link>
            )
          })}
        </div>

        {/* Voice Rooms */}
        <div className="mt-6 mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Voice Rooms
        </div>
        <div className="space-y-1">
          {rooms.map((room) => {
            const isActive = location.pathname === `/voice/${room.slug}`
            return (
              <Link
                key={room.id}
                to={`/voice/${room.slug}`}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                }`}
              >
                <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0" />
                </svg>
                {room.name}
              </Link>
            )
          })}
        </div>

        {/* Direct Messages */}
        <div className="mt-6 mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Direct Messages
        </div>
        <div className="space-y-1">
          <Link
            to="/dm"
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              location.pathname.startsWith('/dm')
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Messages
            </div>
            {unreadDmCount > 0 && (
              <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-500 px-1.5 text-xs font-medium text-white">
                {unreadDmCount}
              </span>
            )}
          </Link>
        </div>
      </nav>
    </aside>
  )
}
