/**
 * ForumRail — Server list sidebar for the Forumline desktop app.
 *
 * Displays joined forums as icons in a vertical rail (like Discord's server list).
 * Only rendered in the Tauri desktop app context.
 * State is managed by ForumProvider.
 */

import { useState, useCallback, type ReactNode } from 'react'
import { useForum } from './ForumProvider'

/** Tooltip that appears to the right of a rail icon */
function RailTooltip({ label, children }: { label: string; children: ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div
      className="relative"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white shadow-lg">
          {label}
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-slate-950" />
        </div>
      )}
    </div>
  )
}

interface ForumRailProps {
  onDmClick?: () => void
  dmUnreadCount?: number
  onSettingsClick?: () => void
}

export default function ForumRail({ onDmClick, dmUnreadCount = 0, onSettingsClick }: ForumRailProps = {}) {
  const { forums, activeForum, unreadCounts, switchForum, goHome, addForum } = useForum()
  const [showAddModal, setShowAddModal] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const handleAddForum = useCallback(async () => {
    if (!addUrl.trim()) return
    setAdding(true)
    setAddError(null)
    try {
      await addForum(addUrl.trim())
      setShowAddModal(false)
      setAddUrl('')
    } catch (err) {
      setAddError(String(err))
    } finally {
      setAdding(false)
    }
  }, [addUrl, addForum])

  const totalUnread = (domain: string) => {
    const counts = unreadCounts[domain]
    if (!counts) return 0
    return counts.notifications + counts.chat_mentions + counts.dms
  }

  return (
    <>
      <div className="flex w-[72px] shrink-0 flex-col items-center gap-2 border-r border-slate-700 bg-slate-900 py-3">
        {/* Home / current app */}
        <RailTooltip label="Home">
          <button
            onClick={goHome}
            className={`group relative flex h-12 w-12 items-center justify-center rounded-2xl transition-all hover:rounded-xl ${
              activeForum === null
                ? 'rounded-xl bg-indigo-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-indigo-600 hover:text-white'
            }`}
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </button>
        </RailTooltip>

        {/* Divider */}
        {forums.length > 0 && (
          <div className="mx-auto h-0.5 w-8 rounded-full bg-slate-700" />
        )}

        {/* Forum icons */}
        {forums.map((forum) => {
          const unread = totalUnread(forum.domain)
          const isActive = activeForum?.domain === forum.domain
          return (
            <RailTooltip label={forum.name}>
              <button
                key={forum.domain}
                onClick={() => switchForum(forum.domain)}
                className={`group relative flex h-12 w-12 items-center justify-center rounded-2xl transition-all hover:rounded-xl ${
                  isActive
                    ? 'rounded-xl bg-indigo-600'
                    : 'bg-slate-700 hover:bg-slate-600'
                }`}
              >
                {forum.icon_url ? (
                  <img
                    src={forum.icon_url.startsWith('/') ? `${forum.web_base}${forum.icon_url}` : forum.icon_url}
                    alt={forum.name}
                    className="h-8 w-8 rounded-lg object-cover"
                    onError={(e) => {
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
            </RailTooltip>
          )
        })}

        {/* Add Forum button */}
        <RailTooltip label="Add a forum">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-green-400 transition-all hover:rounded-xl hover:bg-green-600 hover:text-white"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
        </RailTooltip>

        {/* Spacer */}
        <div className="flex-1" />

        {/* DM Button (desktop app only) */}
        {onDmClick && (
          <RailTooltip label="Direct Messages">
            <button
              onClick={onDmClick}
              className="group relative flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-slate-400 transition-all hover:rounded-xl hover:bg-slate-700 hover:text-white"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {dmUnreadCount > 0 && (
                <div className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {dmUnreadCount > 99 ? '99+' : dmUnreadCount}
                </div>
              )}
            </button>
          </RailTooltip>
        )}

        {/* Settings */}
        <RailTooltip label="Settings">
          <button
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-slate-400 transition-all hover:rounded-xl hover:bg-slate-700 hover:text-white"
            onClick={onSettingsClick ?? (() => {
              goHome()
              window.location.hash = '/settings'
            })}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </RailTooltip>
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
