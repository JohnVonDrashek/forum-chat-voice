import { useState, useEffect } from 'react'
import { useHub } from '@johnvondrashek/forumline-react'
import type { HubProfile } from '@johnvondrashek/forumline-protocol'
import Avatar from './Avatar'
import Input from './ui/Input'

interface DmNewMessageProps {
  onSelectUser: (userId: string) => void
}

export default function DmNewMessage({ onSelectUser }: DmNewMessageProps) {
  const { hubClient } = useHub()
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState<HubProfile[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!searchQuery.trim() || !hubClient) {
      setResults([])
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const profiles = await hubClient.searchProfiles(searchQuery)
        setResults(profiles)
      } catch (err) {
        console.error('[Hub:DM] Profile search failed:', err)
        setResults([])
      }
      setSearching(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, hubClient])

  return (
    <div className="flex h-full flex-col">
      <div className="p-4">
        <Input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search Forumline users..."
          className="w-full"
          autoFocus
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {searching && (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-500" />
          </div>
        )}

        {!searching && searchQuery.trim() && results.length === 0 && (
          <div className="px-4 py-3 text-center text-sm text-slate-400">
            No Forumline users found
          </div>
        )}

        {results.map(profile => (
          <button
            key={profile.id}
            onClick={() => onSelectUser(profile.id)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800"
          >
            <Avatar avatarUrl={profile.avatar_url} size={40} />
            <div className="min-w-0">
              <div className="font-medium text-white">
                {profile.display_name || profile.username}
              </div>
              <div className="text-sm text-slate-400">@{profile.username}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
