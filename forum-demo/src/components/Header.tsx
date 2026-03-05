import { Link, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import Avatar from '../components/Avatar'
import { supabase } from '../lib/supabase'
import { useDataProvider } from '../lib/data-provider'
import Skeleton from '../components/ui/Skeleton'
import { formatRelativeTime } from '../lib/dateFormatters'
import { queryKeys, queryOptions } from '../lib/queries'
import type { Notification as DBNotification } from '../types'

interface HeaderProps {
  onMenuClick?: () => void
}

interface NotifItem {
  id: string
  type: string
  title: string
  message: string
  link: string
  read: boolean
  timestamp: Date
}

function toNotifItem(n: DBNotification): NotifItem {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    link: n.link || '#',
    read: n.read,
    timestamp: new Date(n.created_at),
  }
}

export default function Header({ onMenuClick }: HeaderProps) {
  const dp = useDataProvider()
  const { user, signOut, loading } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fetch notifications via React Query
  const { data: rawNotifications = [] } = useQuery({
    queryKey: queryKeys.notifications(user?.id ?? ''),
    queryFn: () => dp.getNotifications(user!.id),
    enabled: !!user,
    ...queryOptions.realtime,
  })

  const notifications: NotifItem[] = rawNotifications.map(toNotifItem)
  const unreadCount = notifications.filter(n => !n.read).length

  // Realtime subscription — invalidate query on new notifications
  useEffect(() => {
    if (!user) return

    const sub = supabase
      .channel('header-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.notifications(user.id) })
        }
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [user, queryClient])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close notification dropdown on Escape
  useEffect(() => {
    if (!showNotifications) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowNotifications(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showNotifications])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
      setSearchQuery('')
    }
  }

  const handleNotificationClick = async (notification: NotifItem) => {
    if (!notification.read) {
      await dp.markNotificationRead(notification.id)
      if (user) {
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications(user.id) })
      }
    }
    setShowNotifications(false)
    navigate(notification.link)
  }

  const markAllAsRead = async () => {
    if (user) {
      await dp.markAllNotificationsRead(user.id)
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(user.id) })
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'reply':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        )
      case 'mention':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
          </svg>
        )
      case 'like':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        )
      case 'follow':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        )
      default:
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )
    }
  }

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'reply': return 'bg-blue-500'
      case 'mention': return 'bg-amber-500'
      case 'like': return 'bg-pink-500'
      case 'follow': return 'bg-green-500'
      case 'dm': return 'bg-indigo-500'
      default: return 'bg-slate-500'
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-700 bg-slate-800/80 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {/* Mobile menu button */}
          <button
            onClick={onMenuClick}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white lg:hidden"
            aria-label="Toggle menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white">
            <svg className="h-8 w-8 text-indigo-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
            <span className="hidden sm:inline">Forum</span>
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} role="search" className="relative hidden md:block">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              aria-label="Search the forum"
              className="w-64 rounded-lg border border-slate-600 bg-slate-700 px-4 py-1.5 text-sm text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-600 bg-slate-800 px-1.5 text-xs text-slate-400">
              /
            </kbd>
          </form>

          {/* Mobile search button */}
          <Link
            to="/search"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white md:hidden"
            aria-label="Search"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </Link>

          {/* Notifications */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
              aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
              aria-expanded={showNotifications}
              aria-haspopup="true"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-medium text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Dropdown */}
            {showNotifications && (
              <div role="menu" aria-label="Notifications" className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-700 bg-slate-800 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
                  <h3 className="font-semibold text-white">Notifications</h3>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>

                <div className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="p-4 text-center text-slate-400">
                      No notifications
                    </div>
                  ) : (
                    notifications.map(notification => (
                      <button
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-700/50 ${
                          !notification.read ? 'bg-slate-700/30' : ''
                        }`}
                      >
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white ${getNotificationColor(notification.type)}`}>
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm font-medium ${notification.read ? 'text-slate-300' : 'text-white'}`}>
                              {notification.title}
                            </span>
                            <span className="shrink-0 text-xs text-slate-500">
                              {formatRelativeTime(notification.timestamp)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-sm text-slate-400 line-clamp-2">
                            {notification.message}
                          </p>
                        </div>
                        {!notification.read && (
                          <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
                        )}
                      </button>
                    ))
                  )}
                </div>

                <div className="border-t border-slate-700 p-2">
                  <button
                    onClick={() => setShowNotifications(false)}
                    className="block w-full rounded-lg py-2 text-center text-sm text-indigo-400 hover:bg-slate-700/50 hover:text-indigo-300"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Auth */}
          {loading ? (
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="hidden h-4 w-20 sm:block" />
            </div>
          ) : user ? (
            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                to="/admin"
                className="hidden rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white sm:block"
                title="Admin Dashboard"
                aria-label="Admin Dashboard"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </Link>
              <Link
                to={`/u/${user.user_metadata?.username || 'me'}`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-700 sm:px-3"
              >
                <Avatar seed={user.id} type="user" avatarUrl={user.avatar} size={24} />
                <span className="hidden sm:inline">{user.user_metadata?.username || user.email}</span>
              </Link>
              <button
                onClick={signOut}
                className="hidden rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-700 hover:text-white sm:block"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="hidden rounded-lg px-4 py-1.5 text-sm text-slate-300 hover:bg-slate-700 sm:block"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 sm:px-4"
              >
                Sign Up
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
