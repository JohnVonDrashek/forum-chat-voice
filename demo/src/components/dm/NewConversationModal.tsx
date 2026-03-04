import { useState, useEffect, useCallback } from 'react'
import Avatar from '../Avatar'
import Input from '../ui/Input'
import Skeleton from '../ui/Skeleton'
import type { HubProfile } from '@johnvondrashek/forumline-protocol'

interface NewConversationModalProps {
  hubClient: { searchProfiles: (query: string) => Promise<HubProfile[]> } | null
  onSelectUser: (profile: HubProfile) => void
  onClose: () => void
}

export default function NewConversationModal({ hubClient, onSelectUser, onClose }: NewConversationModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [hubSearchResults, setHubSearchResults] = useState<HubProfile[]>([])
  const [searching, setSearching] = useState(false)

  // User search with debounce
  useEffect(() => {
    if (!searchQuery.trim() || !hubClient) {
      setHubSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await hubClient.searchProfiles(searchQuery)
        setHubSearchResults(results)
      } catch (err) {
        console.error('[FLD:DM] Hub profile search failed:', err)
        setHubSearchResults([])
      }
      setSearching(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, hubClient])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleClose = useCallback(() => {
    setSearchQuery('')
    setHubSearchResults([])
    onClose()
  }, [onClose])

  const handleSelect = useCallback((profile: HubProfile) => {
    setSearchQuery('')
    setHubSearchResults([])
    onSelectUser(profile)
  }, [onSelectUser])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div
        className="fixed inset-0 bg-black/60"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div role="dialog" aria-modal="true" aria-labelledby="new-message-title" className="relative w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h3 id="new-message-title" className="font-semibold text-white">New Message</h3>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
            aria-label="Close dialog"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4">
          <Input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search Forumline users..."
            aria-label="Search users"
            className="w-full"
            autoFocus
          />
        </div>

        <div className="max-h-64 overflow-y-auto">
          {searching && (
            <div className="space-y-1">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <Skeleton className={`h-4 ${i % 2 === 0 ? 'w-28' : 'w-20'}`} />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!searching && searchQuery.trim() && hubSearchResults.length === 0 && (
            <div className="px-4 py-3 text-center text-sm text-slate-400">No Forumline users found</div>
          )}
          {hubSearchResults.map(profile => (
            <button
              key={profile.id}
              onClick={() => handleSelect(profile)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-700/50"
            >
              <Avatar seed={profile.id} type="user" avatarUrl={profile.avatar_url} size={40} className="shrink-0" showGlobe />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium text-white">
                  {profile.display_name || profile.username}
                </div>
                <div className="text-sm text-slate-400">@{profile.username}</div>
              </div>
            </button>
          ))}
        </div>

      </div>
    </div>
  )
}
