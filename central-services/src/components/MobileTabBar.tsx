import { useForum } from '@johnvondrashek/forumline-react'

type AppView = 'forums' | 'settings' | 'dms'

interface MobileTabBarProps {
  view: AppView
  onChangeView: (view: AppView) => void
  dmUnreadCount: number
}

export default function MobileTabBar({ view, onChangeView, dmUnreadCount }: MobileTabBarProps) {
  const { activeForum, goHome } = useForum()

  const handleForumsClick = () => {
    if (view === 'forums' && activeForum) {
      // Viewing a forum — go back to forum list
      goHome()
    }
    onChangeView('forums')
  }

  return (
    <div className="flex border-t border-slate-700 bg-slate-900 pb-[env(safe-area-inset-bottom)]">
      {/* Forums */}
      <button
        onClick={handleForumsClick}
        className={`flex flex-1 flex-col items-center gap-1 py-2 ${view === 'forums' ? 'text-indigo-400' : 'text-slate-500'}`}
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
        <span className="text-[10px] font-medium">Forums</span>
      </button>

      {/* DMs */}
      <button
        onClick={() => onChangeView(view === 'dms' ? 'forums' : 'dms')}
        className={`relative flex flex-1 flex-col items-center gap-1 py-2 ${view === 'dms' ? 'text-indigo-400' : 'text-slate-500'}`}
      >
        <div className="relative">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {dmUnreadCount > 0 && (
            <div className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
              {dmUnreadCount > 99 ? '99+' : dmUnreadCount}
            </div>
          )}
        </div>
        <span className="text-[10px] font-medium">DMs</span>
      </button>

      {/* Settings */}
      <button
        onClick={() => onChangeView(view === 'settings' ? 'forums' : 'settings')}
        className={`flex flex-1 flex-col items-center gap-1 py-2 ${view === 'settings' ? 'text-indigo-400' : 'text-slate-500'}`}
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-[10px] font-medium">Settings</span>
      </button>
    </div>
  )
}
