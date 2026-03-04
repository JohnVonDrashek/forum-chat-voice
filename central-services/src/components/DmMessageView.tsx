import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useHub } from '@johnvondrashek/forumline-react'
import type { HubDirectMessage } from '@johnvondrashek/forumline-protocol'
import Avatar from './Avatar'
import Input from './ui/Input'
import Button from './ui/Button'
import { formatMessageTime } from '../lib/dateFormatters'

interface DmMessageViewProps {
  recipientId: string
}

export default function DmMessageView({ recipientId }: DmMessageViewProps) {
  const { hubClient, hubSupabase, hubUserId } = useHub()
  const queryClient = useQueryClient()
  const [newMessage, setNewMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { data: conversations = [] } = useQuery({
    queryKey: ['hub', 'dm', 'conversations'],
    queryFn: () => hubClient!.getConversations(),
    enabled: !!hubClient,
  })

  const currentConversation = conversations.find(c => c.recipientId === recipientId)
  const recipientName = currentConversation?.recipientName || 'User'

  const { data: rawMessages = [] } = useQuery({
    queryKey: ['hub', 'dm', 'messages', recipientId],
    queryFn: () => hubClient!.getMessages(recipientId),
    enabled: !!hubClient,
    staleTime: 5_000,
    refetchInterval: 15_000,
  })

  useEffect(() => {
    if (!hubSupabase) return

    const sub = hubSupabase
      .channel(`hub-dm-messages-${recipientId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hub_direct_messages' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['hub', 'dm', 'messages', recipientId] })
          queryClient.invalidateQueries({ queryKey: ['hub', 'dm', 'conversations'] })
        }
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [hubSupabase, recipientId, queryClient])

  useEffect(() => {
    if (!hubClient || rawMessages.length === 0) return
    hubClient.markRead(recipientId).then(() => {
      queryClient.invalidateQueries({ queryKey: ['hub', 'dm', 'conversations'] })
    }).catch(console.error)
  }, [recipientId, hubClient, rawMessages.length, queryClient])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rawMessages.length])

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!hubClient) throw new Error('Not connected')
      await hubClient.sendMessage(recipientId, content)
    },
    onMutate: async (content: string) => {
      const queryKey = ['hub', 'dm', 'messages', recipientId] as const
      await queryClient.cancelQueries({ queryKey })
      const previousMessages = queryClient.getQueryData<HubDirectMessage[]>(queryKey)

      const optimisticDM: HubDirectMessage = {
        id: `temp-${Date.now()}`,
        sender_id: hubUserId || '',
        recipient_id: recipientId,
        content,
        created_at: new Date().toISOString(),
        read: false,
      }

      queryClient.setQueryData(
        queryKey,
        (old: HubDirectMessage[] = []) => [...old, optimisticDM]
      )

      setNewMessage('')
      return { previousMessages, queryKey }
    },
    onError: (_error, _content, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(context.queryKey, context.previousMessages)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['hub', 'dm', 'conversations'] })
      queryClient.invalidateQueries({ queryKey: ['hub', 'dm', 'messages', recipientId] })
    },
  })

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim()) return
    sendMutation.mutate(newMessage.trim())
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
        <Avatar avatarUrl={currentConversation?.recipientAvatarUrl} size={32} />
        <h3 className="font-medium text-white">{recipientName}</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {rawMessages.length === 0 && (
            <div className="py-12 text-center text-slate-500">
              <p>No messages yet. Say hello!</p>
            </div>
          )}
          {rawMessages.map(message => {
            const isMe = message.sender_id === hubUserId
            return (
              <div key={message.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%]`}>
                  <div className={`rounded-2xl px-4 py-2 ${isMe ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-200'}`}>
                    {message.content}
                  </div>
                  <div className={`mt-1 text-xs text-slate-500 ${isMe ? 'text-right' : 'text-left'}`}>
                    {formatMessageTime(new Date(message.created_at))}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-slate-700 p-4">
        <form onSubmit={handleSend} className="flex gap-2">
          <Input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder={`Message ${recipientName}...`}
            className="flex-1"
          />
          <Button type="submit" disabled={!newMessage.trim()}>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </Button>
        </form>
      </div>
    </div>
  )
}
