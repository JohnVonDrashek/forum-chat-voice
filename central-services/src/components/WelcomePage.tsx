import type { Session } from '@supabase/supabase-js'
import { useForum } from '@johnvondrashek/forumline-react'
import MobileForumList from './MobileForumList'

interface WelcomePageProps {
  hubSession: Session | null
  isHubConnected: boolean
  onGoToSettings: () => void
}

export default function WelcomePage({ hubSession, isHubConnected, onGoToSettings }: WelcomePageProps) {
  const { forums } = useForum()

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-slate-900 px-4">
      {forums.length > 0 && (
        <div className="mx-auto mt-6 w-full max-w-md">
          <MobileForumList />
        </div>
      )}

      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-indigo-600/20">
            <svg className="h-10 w-10 text-indigo-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-white">Welcome to Forumline</h1>
          <p className="mt-2 text-slate-400">
            Your multi-forum client. Add forums, chat across communities, and send direct messages.
          </p>

          <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <div className="flex items-center justify-center gap-2">
              <div className={`h-2 w-2 rounded-full ${isHubConnected ? 'bg-green-400' : 'bg-slate-500'}`} />
              <span className="text-sm text-slate-300">
                {isHubConnected
                  ? `Connected as @${hubSession?.user?.user_metadata?.username || hubSession?.user?.email || 'user'}`
                  : 'Not connected to Forumline Hub'}
              </span>
            </div>
            {!isHubConnected && (
              <button
                onClick={onGoToSettings}
                className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Sign in to enable cross-forum DMs
              </button>
            )}
          </div>

          {forums.length === 0 ? (
            <div className="mt-6">
              <p className="text-sm text-slate-400">
                Tap <span className="font-medium text-green-400">Add Forum</span> below to add your first forum
              </p>
              <div className="mx-auto mt-4 max-w-md">
                <MobileForumList />
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <p className="text-sm text-slate-400">
                {forums.length} forum{forums.length !== 1 ? 's' : ''} connected. Tap one above to open it.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
