import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useHub } from '@johnvondrashek/forumline-react'
import Avatar from './Avatar'
import { formatShortTimeAgo } from '../lib/dateFormatters'

interface DmConversationListProps {
  onSelectConversation: (recipientId: string) => void
}

export default function DmConversationList({ onSelectConversation }: DmConversationListProps) {
  const { hubClient, hubSupabase } = useHub()
  const queryClient = useQueryClient()

  const { data: conversations = [] } = useQuery({
    queryKey: ['hub', 'dm', 'conversations'],
    queryFn: () => hubClient!.getConversations(),
    enabled: !!hubClient,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (!hubSupabase) return

    const sub = hubSupabase
      .channel('hub-dm-conversations')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hub_direct_messages' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['hub', 'dm', 'conversations'] })
        }
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [hubSupabase, queryClient])

  if (conversations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-700">
          <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p className="text-sm text-slate-400">No conversations yet</p>
        <p className="mt-1 text-xs text-slate-500">Start a new message to begin chatting</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {conversations.map(conversation => (
        <button
          key={conversation.recipientId}
          onClick={() => onSelectConversation(conversation.recipientId)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800"
        >
          <div className="relative">
            <Avatar avatarUrl={conversation.recipientAvatarUrl} size={40} />
            {conversation.unreadCount > 0 && (
              <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-xs font-medium text-white">
                {conversation.unreadCount}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className={`font-medium ${conversation.unreadCount > 0 ? 'text-white' : 'text-slate-200'}`}>
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
        </button>
      ))}
    </div>
  )
}
