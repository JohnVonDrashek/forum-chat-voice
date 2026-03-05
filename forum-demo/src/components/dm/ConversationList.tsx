import { Link } from 'react-router-dom'
import Avatar from '../Avatar'
import { formatShortTimeAgo } from '../../lib/dateFormatters'

interface Conversation {
  recipientId: string
  recipientName: string
  recipientAvatarUrl?: string | null
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
}

interface ConversationListProps {
  conversations: Conversation[]
  activeRecipientId?: string
  visible: boolean
  onNewMessage: () => void
}

export default function ConversationList({ conversations, activeRecipientId, visible, onNewMessage }: ConversationListProps) {
  return (
    <div className={`${visible ? 'flex' : 'hidden'} w-full flex-col border-r border-slate-700 md:flex md:w-80`}>
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h2 className="font-semibold text-white">Messages</h2>
        <button
          onClick={onNewMessage}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
          title="New message"
          aria-label="New message"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="p-4 text-center text-slate-400">
            <p>No conversations yet</p>
            <button
              onClick={onNewMessage}
              className="mt-2 text-sm text-indigo-400 hover:text-indigo-300"
            >
              Start a new message
            </button>
          </div>
        ) : (
          conversations.map(conversation => (
            <Link
              key={conversation.recipientId}
              to={`/dm/${conversation.recipientId}`}
              className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-700/50 ${
                activeRecipientId === conversation.recipientId ? 'bg-slate-700/50' : ''
              }`}
            >
              <div className="relative">
                <Avatar seed={conversation.recipientId} type="user" avatarUrl={conversation.recipientAvatarUrl} size={40} showGlobe />
                {conversation.unreadCount > 0 && (
                  <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-xs font-medium text-white">
                    {conversation.unreadCount}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className={`flex items-center gap-1.5 font-medium ${conversation.unreadCount > 0 ? 'text-white' : 'text-slate-200'}`}>
                    {conversation.recipientName}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatShortTimeAgo(new Date(conversation.lastMessageTime))}
                  </span>
                </div>
                <p className={`truncate text-sm ${conversation.unreadCount > 0 ? 'font-medium text-slate-300' : 'text-slate-400'}`}>
                  {conversation.lastMessage}
                </p>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
