/**
 * ForumRail — Server list sidebar for the Forumline desktop app.
 *
 * Displays joined forums as icons in a vertical rail (like Discord's server list).
 * Only rendered in the Tauri desktop app context.
 */

import { useState, useEffect, useCallback } from 'react'
import { isTauri } from '../lib/tauri'

interface ForumMembership {
  domain: string
  name: string
  icon_url: string
  web_base: string
  api_base: string
  capabilities: string[]
  accent_color?: string
  added_at: string
}

interface UnreadCounts {
  notifications: number
  chat_mentions: number
  dms: number
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

async function tauriListen<T>(event: string, handler: (event: { payload: T }) => void) {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, handler)
}

export default function ForumRail() {
  const [forums, setForums] = useState<ForumMembership[]>([])
  const [activeForum, setActiveForum] = useState<string | null>(null)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, UnreadCounts>>({})
  const [showAddModal, setShowAddModal] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const tauriActive = isTauri()

  // Load forum list on mount
  useEffect(() => {
    if (!tauriActive) return
    const load = async () => {
      try {
        const list = await tauriInvoke<ForumMembership[]>('get_forum_list')
        setForums(list)
        const active = await tauriInvoke<string | null>('get_active_forum')
        setActiveForum(active)
        const counts = await tauriInvoke<Record<string, UnreadCounts>>('get_unread_counts')
        setUnreadCounts(counts)
      } catch (err) {
        console.error('[Forumline:Rail] Failed to load forum list:', err)
      }
    }
    load()
  }, [tauriActive])

  // Listen for forum switch events
  useEffect(() => {
    if (!tauriActive) return
    let unlisten: (() => void) | undefined
    tauriListen<string>('forum-switched', (event) => {
      setActiveForum(event.payload)
    }).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [tauriActive])

  const handleSwitchForum = useCallback(async (domain: string) => {
    try {
      await tauriInvoke('switch_forum', { domain })
      setActiveForum(domain)
    } catch (err) {
      console.error('[Forumline:Rail] Failed to switch forum:', err)
    }
  }, [])

  const handleAddForum = useCallback(async () => {
    if (!addUrl.trim()) return
    setAdding(true)
    setAddError(null)
    try {
      await tauriInvoke('add_forum', { url: addUrl.trim() })
      const list = await tauriInvoke<ForumMembership[]>('get_forum_list')
      setForums(list)
      setShowAddModal(false)
      setAddUrl('')
    } catch (err) {
      setAddError(String(err))
    } finally {
      setAdding(false)
    }
  }, [addUrl])

  const totalUnread = (domain: string) => {
    const counts = unreadCounts[domain]
    if (!counts) return 0
    return counts.notifications + counts.chat_mentions + counts.dms
  }

  // Only render in Tauri desktop app
  if (!tauriActive) return null

  return (
    <>
      <div className="flex w-[72px] shrink-0 flex-col items-center gap-2 border-r border-slate-700 bg-slate-900 py-3">
        {/* Home / current app */}
        <button
          onClick={() => setActiveForum(null)}
          className={`group relative flex h-12 w-12 items-center justify-center rounded-2xl transition-all hover:rounded-xl ${
            activeForum === null
              ? 'rounded-xl bg-indigo-600 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-indigo-600 hover:text-white'
          }`}
          title="Home"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
        </button>

        {/* Divider */}
        {forums.length > 0 && (
          <div className="mx-auto h-0.5 w-8 rounded-full bg-slate-700" />
        )}

        {/* Forum icons */}
        {forums.map((forum) => {
          const unread = totalUnread(forum.domain)
          const isActive = activeForum === forum.domain
          return (
            <button
              key={forum.domain}
              onClick={() => handleSwitchForum(forum.domain)}
              className={`group relative flex h-12 w-12 items-center justify-center rounded-2xl transition-all hover:rounded-xl ${
                isActive
                  ? 'rounded-xl bg-indigo-600'
                  : 'bg-slate-700 hover:bg-slate-600'
              }`}
              title={forum.name}
            >
              {forum.icon_url ? (
                <img
                  src={forum.icon_url.startsWith('/') ? `${forum.web_base}${forum.icon_url}` : forum.icon_url}
                  alt={forum.name}
                  className="h-8 w-8 rounded-lg object-cover"
                  onError={(e) => {
                    // Fallback to first letter
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                    target.parentElement!.textContent = forum.name[0].toUpperCase()
                  }}
                />
              ) : (
                <span className="text-lg font-bold text-white">
                  {forum.name[0].toUpperCase()}
                </span>
              )}

              {/* Active indicator */}
              {isActive && (
                <div className="absolute -left-1 top-1/2 h-10 w-1 -translate-y-1/2 rounded-r-full bg-white" />
              )}

              {/* Unread badge */}
              {unread > 0 && (
                <div className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </div>
              )}
            </button>
          )
        })}

        {/* Add Forum button */}
        <button
          onClick={() => setShowAddModal(true)}
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-green-400 transition-all hover:rounded-xl hover:bg-green-600 hover:text-white"
          title="Add a forum"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings */}
        <button
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-slate-400 transition-all hover:rounded-xl hover:bg-slate-700 hover:text-white"
          title="Settings"
          onClick={() => {
            // Navigate to settings in the main app
            setActiveForum(null)
            window.location.hash = '/settings'
          }}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Add Forum Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => { setShowAddModal(false); setAddError(null); setAddUrl('') }}
          />
          <div className="relative w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Add a Forum</h3>
            <p className="mt-1 text-sm text-slate-400">
              Enter the URL of a Forumline-compatible forum
            </p>

            <input
              type="url"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="https://example-forum.com"
              className="mt-4 w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddForum()
                if (e.key === 'Escape') { setShowAddModal(false); setAddError(null); setAddUrl('') }
              }}
            />

            {addError && (
              <p className="mt-2 text-sm text-red-400">{addError}</p>
            )}

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => { setShowAddModal(false); setAddError(null); setAddUrl('') }}
                className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-700 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleAddForum}
                disabled={adding || !addUrl.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {adding ? 'Adding...' : 'Add Forum'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
