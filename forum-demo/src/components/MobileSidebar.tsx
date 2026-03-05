import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useCallback } from 'react'
import { useVoice } from '../lib/voice'
import NavLink from './ui/NavLink'
import type { Category, ChatChannel, VoiceRoom } from '../types'

interface MobileSidebarProps {
  isOpen: boolean
  onClose: () => void
  categories: Category[]
  channels: ChatChannel[]
  rooms: VoiceRoom[]
  unreadDmCount: number
}

export default function MobileSidebar({ isOpen, onClose, categories, channels, rooms, unreadDmCount }: MobileSidebarProps) {
  const location = useLocation()
  const voice = useVoice()
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Close sidebar on route change
  useEffect(() => {
    onClose()
  }, [location.pathname, onClose])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Focus trap when open
  const handleFocusTrap = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !sidebarRef.current) return
    const focusableElements = sidebarRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (focusableElements.length === 0) return
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault()
        lastElement.focus()
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault()
        firstElement.focus()
      }
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleFocusTrap)
    // Focus the close button when sidebar opens
    const closeBtn = sidebarRef.current?.querySelector<HTMLElement>('button[aria-label="Close menu"]')
    closeBtn?.focus()
    return () => document.removeEventListener('keydown', handleFocusTrap)
  }, [isOpen, handleFocusTrap])

  // Prevent body scroll when sidebar is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className="fixed inset-y-0 left-0 z-50 w-[85vw] max-w-72 bg-slate-800 shadow-xl lg:hidden"
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-700 px-4">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white" onClick={onClose}>
            <svg className="h-8 w-8 text-indigo-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
            <span>Forum</span>
          </Link>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
            aria-label="Close menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav aria-label="Main navigation" className="h-[calc(100vh-3.5rem)] overflow-y-auto p-4">
          <div className="mb-4 space-y-1">
            <NavLink to="/" variant="primary" className="py-2.5 font-medium">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Home
            </NavLink>
            <NavLink to="/bookmarks" variant="primary" className="py-2.5 font-medium">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              Bookmarks
            </NavLink>
            <NavLink to="/settings" variant="primary" className="py-2.5 font-medium">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </NavLink>
          </div>

          <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Categories
          </div>
          <div className="space-y-1">
            {categories.length === 0 ? (
              [...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2.5 animate-pulse">
                  <div className="h-2 w-2 rounded-full bg-slate-700" />
                  <div className="h-4 w-24 rounded bg-slate-700" />
                </div>
              ))
            ) : (
              categories.map((category) => {
                const isActive = location.pathname === `/c/${category.slug}`
                return (
                  <Link
                    key={category.id}
                    to={`/c/${category.slug}`}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    {category.name}
                  </Link>
                )
              })
            )}
          </div>

          {/* Chat Channels */}
          <div className="mt-6 mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Chat Channels
          </div>
          <div className="space-y-1">
            {channels.length === 0 ? (
              [...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2.5 animate-pulse">
                  <div className="h-4 w-3 rounded bg-slate-700" />
                  <div className="h-4 w-20 rounded bg-slate-700" />
                </div>
              ))
            ) : (
              channels.map((channel) => {
                const isActive = location.pathname === `/chat/${channel.slug}`
                return (
                  <Link
                    key={channel.id}
                    to={`/chat/${channel.slug}`}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-green-400">#</span>
                    {channel.name}
                  </Link>
                )
              })
            )}
          </div>

          {/* Voice Rooms */}
          <div className="mt-6 mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Voice Rooms
          </div>
          <div className="space-y-1">
            {rooms.length === 0 ? (
              [...Array(2)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2.5 animate-pulse">
                  <div className="h-4 w-4 rounded bg-slate-700" />
                  <div className="h-4 w-24 rounded bg-slate-700" />
                </div>
              ))
            ) : (
              rooms.map((room) => {
                const isActive = location.pathname === `/voice/${room.slug}`
                const isConnectedRoom = voice.isConnected && voice.connectedRoomSlug === room.slug
                const participantInfo = voice.roomParticipantCounts[room.slug]
                const count = participantInfo?.count || 0
                return (
                  <Link
                    key={room.id}
                    to={`/voice/${room.slug}`}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isConnectedRoom
                        ? 'border-l-2 border-green-400 bg-green-500/10 text-green-300'
                        : isActive
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0" />
                      </svg>
                      {room.name}
                    </div>
                    {count > 0 && (
                      <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-green-500/20 px-1.5 text-xs font-medium text-green-400">
                        {count}
                      </span>
                    )}
                  </Link>
                )
              })
            )}
          </div>

          {/* Voice Controls — shown when connected */}
          {voice.isConnected && voice.connectedRoomName && (
            <div className="mt-3 rounded-lg border border-green-500/30 bg-green-500/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-green-300">
                <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0" />
                </svg>
                {voice.connectedRoomName}
              </div>
              {voice.participants.length > 0 && (
                <p className="mt-1 truncate text-xs text-slate-400">
                  {voice.participants.slice(0, 3).map(p => p.name).join(', ')}
                  {voice.participants.length > 3 && ` +${voice.participants.length - 3}`}
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={voice.toggleMute}
                  className={`rounded-md p-1.5 transition-colors ${
                    voice.isMuted
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-slate-700 text-white hover:bg-slate-600'
                  }`}
                  title={voice.isMuted ? 'Unmute' : 'Mute'}
                  aria-label={voice.isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  aria-pressed={voice.isMuted}
                >
                  {voice.isMuted ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0M19 19l-7-7m0 0l-7-7m7 7l7-7m-7 7l-7 7" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={voice.toggleDeafen}
                  className={`rounded-md p-1.5 transition-colors ${
                    voice.isDeafened
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-slate-700 text-white hover:bg-slate-600'
                  }`}
                  title={voice.isDeafened ? 'Undeafen' : 'Deafen'}
                  aria-label={voice.isDeafened ? 'Undeafen audio' : 'Deafen audio'}
                  aria-pressed={voice.isDeafened}
                >
                  {voice.isDeafened ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={voice.leaveRoom}
                  className="ml-auto rounded-md bg-red-500/20 px-2 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
                  title="Disconnect"
                  aria-label="Disconnect from voice room"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}

          {/* Direct Messages */}
          <div className="mt-6 mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Direct Messages
          </div>
          <div className="space-y-1">
            <Link
              to="/dm"
              className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${
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
                <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-500 px-1.5 text-xs font-medium text-white" aria-label={`${unreadDmCount} unread messages`}>
                  {unreadDmCount}
                </span>
              )}
            </Link>
          </div>
        </nav>
      </div>
    </>
  )
}
