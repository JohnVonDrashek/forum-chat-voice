import { useState } from 'react'
import { useHub } from '@johnvondrashek/forumline-react'
import HubAuth from './HubAuth'
import DmConversationList from './DmConversationList'
import DmMessageView from './DmMessageView'
import DmNewMessage from './DmNewMessage'

type DmView = 'list' | 'conversation' | 'new'

interface DmPanelProps {
  onClose: () => void
}

export default function DmPanel({ onClose }: DmPanelProps) {
  const { isHubConnected } = useHub()
  const [view, setView] = useState<DmView>('list')
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null)

  const handleSelectConversation = (recipientId: string) => {
    setSelectedRecipientId(recipientId)
    setView('conversation')
  }

  const handleBack = () => {
    setView('list')
    setSelectedRecipientId(null)
  }

  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-[400px] flex-col border-l border-slate-700 bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-2">
          {view !== 'list' && (
            <button
              onClick={handleBack}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <h2 className="font-semibold text-white">
            {view === 'new' ? 'New Message' : 'Messages'}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {view === 'list' && isHubConnected && (
            <button
              onClick={() => setView('new')}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
              title="New message"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
            title="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {!isHubConnected ? (
          <div className="flex h-full items-center justify-center p-6">
            <HubAuth />
          </div>
        ) : view === 'new' ? (
          <DmNewMessage onSelectUser={handleSelectConversation} />
        ) : view === 'conversation' && selectedRecipientId ? (
          <DmMessageView recipientId={selectedRecipientId} />
        ) : (
          <DmConversationList onSelectConversation={handleSelectConversation} />
        )}
      </div>
    </div>
  )
}
