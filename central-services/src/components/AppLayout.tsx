import { useState, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ForumRail, ForumWebview, useForum, useHub } from '@johnvondrashek/forumline-react'
import WelcomePage from './WelcomePage'
import DmPanel from './DmPanel'
import SettingsPage from './SettingsPage'

type AppView = 'forums' | 'settings'

interface AppLayoutProps {
  hubSession: Session | null
}

export default function AppLayout({ hubSession }: AppLayoutProps) {
  const { activeForum } = useForum()
  const { isHubConnected } = useHub()
  const [showDmPanel, setShowDmPanel] = useState(false)
  const [view, setView] = useState<AppView>('forums')
  const [authedForums, setAuthedForums] = useState<Set<string>>(new Set())

  const dmUnreadCount = 0

  const authUrlForForum = activeForum && hubSession && !authedForums.has(activeForum.domain)
    ? `${activeForum.api_base}/forumline/auth?hub_token=${hubSession.access_token}`
    : null

  const handleForumAuthed = useCallback((domain: string) => {
    setAuthedForums(prev => new Set(prev).add(domain))
  }, [])

  return (
    <div className="flex h-screen">
      <ForumRail
        onDmClick={() => setShowDmPanel(prev => !prev)}
        dmUnreadCount={dmUnreadCount}
        onSettingsClick={() => {
          setView(view === 'settings' ? 'forums' : 'settings')
        }}
      />

      <div className="relative flex flex-1 overflow-hidden">
        {view === 'settings' ? (
          <SettingsPage hubSession={hubSession} onClose={() => setView('forums')} />
        ) : activeForum ? (
          <ForumWebview
            forum={activeForum}
            authUrl={authUrlForForum}
            onAuthed={handleForumAuthed}
          />
        ) : (
          <WelcomePage hubSession={hubSession} isHubConnected={isHubConnected} />
        )}

        {showDmPanel && (
          <DmPanel onClose={() => setShowDmPanel(false)} />
        )}
      </div>
    </div>
  )
}
