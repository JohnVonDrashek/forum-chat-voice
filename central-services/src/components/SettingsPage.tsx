import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useForum, useHub } from '@johnvondrashek/forumline-react'
import { hubSupabase } from '../App'
import HubAuth from './HubAuth'
import Avatar from './Avatar'
import Button from './ui/Button'
import Card from './ui/Card'

interface SettingsPageProps {
  hubSession: Session | null
  onClose: () => void
}

export default function SettingsPage({ hubSession, onClose }: SettingsPageProps) {
  const { forums, removeForum } = useForum()
  const { isHubConnected } = useHub()
  const [removingDomain, setRemovingDomain] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!hubSession) return
    hubSupabase
      .from('hub_profiles')
      .select('avatar_url')
      .eq('id', hubSession.user.id)
      .single()
      .then(({ data }) => {
        if (data?.avatar_url) setAvatarUrl(data.avatar_url)
      })
  }, [hubSession])

  const handleRemoveForum = async (domain: string) => {
    setRemovingDomain(domain)
    try {
      await removeForum(domain)
    } finally {
      setRemovingDomain(null)
    }
  }

  const handleSignOut = async () => {
    await hubSupabase.auth.signOut()
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-700 px-4 py-4">
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-white">Settings</h1>
      </div>

      <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-6">
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-white">Forumline Hub</h2>
          <p className="mt-1 text-sm text-slate-400">
            Connect to the Forumline Hub for cross-forum direct messages
          </p>

          {isHubConnected && hubSession ? (
            <div className="mt-4">
              <div className="flex items-center gap-3 rounded-lg bg-slate-700/50 p-3">
                <Avatar
                  avatarUrl={avatarUrl}
                  seed={hubSession.user.user_metadata?.username || hubSession.user.email || undefined}
                  size={40}
                />
                <div className="flex-1">
                  <p className="font-medium text-white">
                    {hubSession.user.user_metadata?.username || hubSession.user.email}
                  </p>
                  <p className="text-sm text-slate-400">{hubSession.user.email}</p>
                </div>
                <Button variant="secondary" onClick={handleSignOut}>
                  Sign Out
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <HubAuth />
            </div>
          )}
        </Card>

        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-white">Forums</h2>
          <p className="mt-1 text-sm text-slate-400">
            Manage your connected forums
          </p>

          {forums.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No forums added yet. Go to Home and tap Add Forum to add one.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {forums.map(forum => (
                <div key={forum.domain} className="flex items-center gap-3 rounded-lg bg-slate-700/50 p-3">
                  {forum.icon_url ? (
                    <img
                      src={forum.icon_url.startsWith('/') ? `${forum.web_base}${forum.icon_url}` : forum.icon_url}
                      alt={forum.name}
                      className="h-10 w-10 rounded-lg object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-600 text-lg font-bold text-white">
                      {forum.name[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-white">{forum.name}</p>
                    <p className="text-sm text-slate-400">{forum.domain}</p>
                  </div>
                  <Button
                    variant="danger"
                    onClick={() => handleRemoveForum(forum.domain)}
                    disabled={removingDomain === forum.domain}
                    className="text-sm"
                  >
                    {removingDomain === forum.domain ? 'Removing...' : 'Remove'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
