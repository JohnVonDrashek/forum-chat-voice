import { useState, useEffect, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useForum, useHub } from '@johnvondrashek/forumline-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  const queryClient = useQueryClient()

  const { data: memberships = [] } = useQuery({
    queryKey: ['hub', 'memberships'],
    queryFn: async () => {
      if (!hubSession) return []
      const res = await fetch('/api/memberships', {
        headers: { Authorization: `Bearer ${hubSession.access_token}` },
      })
      if (!res.ok) return []
      return res.json() as Promise<{ forum_domain: string; notifications_muted: boolean }[]>
    },
    enabled: !!hubSession,
  })

  const muteMutation = useMutation({
    mutationFn: async ({ forum_domain, muted }: { forum_domain: string; muted: boolean }) => {
      const res = await fetch('/api/memberships', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hubSession!.access_token}`,
        },
        body: JSON.stringify({ forum_domain, muted }),
      })
      if (!res.ok) throw new Error('Failed to toggle mute')
    },
    onMutate: async ({ forum_domain, muted }) => {
      await queryClient.cancelQueries({ queryKey: ['hub', 'memberships'] })
      const prev = queryClient.getQueryData<{ forum_domain: string; notifications_muted: boolean }[]>(['hub', 'memberships'])
      queryClient.setQueryData<{ forum_domain: string; notifications_muted: boolean }[]>(
        ['hub', 'memberships'],
        (old = []) => old.map(m => m.forum_domain === forum_domain ? { ...m, notifications_muted: muted } : m),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['hub', 'memberships'], ctx.prev)
    },
  })

  const isMuted = useCallback((domain: string) => {
    return memberships.find(m => m.forum_domain === domain)?.notifications_muted ?? false
  }, [memberships])

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
                  <button
                    onClick={() => muteMutation.mutate({ forum_domain: forum.domain, muted: !isMuted(forum.domain) })}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                    title={isMuted(forum.domain) ? 'Unmute notifications' : 'Mute notifications'}
                  >
                    {isMuted(forum.domain) ? (
                      <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                    )}
                  </button>
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
