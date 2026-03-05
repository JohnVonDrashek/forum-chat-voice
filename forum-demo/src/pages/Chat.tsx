import { useState, useRef, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { getDataProvider } from '../lib/data-provider'
import Avatar from '../components/Avatar'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'
import Skeleton from '../components/ui/Skeleton'
import { formatTime, formatDateLabel } from '../lib/dateFormatters'
import type { Profile, ChatMessageWithAuthor } from '../types'

type ChatMessageWithAuthorArray = ChatMessageWithAuthor[]

interface ChatMsg {
  id: string
  channelId: string
  authorId: string
  authorName: string
  authorAvatar: string
  authorAvatarUrl?: string | null
  authorForumlineId?: string | null
  content: string
  createdAt: string
}

function toMsg(row: { id: string; channel_id: string; author_id: string; content: string; created_at: string; author: Profile }): ChatMsg {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    authorName: row.author.display_name || row.author.username,
    authorAvatar: (row.author.display_name?.[0] || row.author.username[0]).toUpperCase(),
    authorAvatarUrl: row.author.avatar_url,
    authorForumlineId: row.author.forumline_id,
    content: row.content,
    createdAt: row.created_at,
  }
}

export default function Chat() {
  const { channelId: channelSlug = 'general' } = useParams()
  const { user, profile } = useAuth()
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Use React Query for channels - instant on tab switch!
  const { data: channels = [] } = useQuery({
    queryKey: queryKeys.channels,
    queryFn: fetchers.channels,
    ...queryOptions.static,
  })

  const channel = channels.find(c => c.slug === channelSlug || c.id === channelSlug)

  // Use React Query for messages - instant on channel switch!
  const { data: cachedMessages = [], isLoading: loading, isError } = useQuery({
    queryKey: queryKeys.chatMessages(channelSlug),
    queryFn: () => fetchers.chatMessagesBySlug(channelSlug),
    ...queryOptions.realtime,
    enabled: !!channel,
  })

  // Sync cached messages to local state
  useEffect(() => {
    if (cachedMessages.length > 0) {
      setMessages(cachedMessages.map((m: ChatMessageWithAuthor) => toMsg({
        id: m.id,
        channel_id: m.channel_id,
        author_id: m.author_id,
        content: m.content,
        created_at: m.created_at,
        author: m.author,
      })))
    }
  }, [cachedMessages])

  // Subscribe to real-time updates
  useEffect(() => {
    if (!channel) return

    console.log('[FLD:Chat] Subscribing to realtime for channel:', channel.slug)
    const sub = supabase
      .channel(`chat:${channel.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${channel.id}` },
        async (payload) => {
          const { data, error } = await supabase
            .from('chat_messages')
            .select('*, author:profiles(*)')
            .eq('id', payload.new.id)
            .single()
          if (error) {
            console.error('[FLD:Chat] Failed to fetch new realtime message:', error)
            return
          }
          if (data) {
            setMessages(prev => {
              if (prev.some(m => m.id === data.id)) return prev
              return [...prev, toMsg(data)]
            })
            // Invalidate cache so next visit has fresh data
            queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(channelSlug) })
          }
        }
      )
      .subscribe((status) => {
        console.log('[FLD:Chat] Subscription status:', status)
      })

    return () => {
      sub.unsubscribe()
    }
  }, [channel?.id, channelSlug, queryClient])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [channelSlug])

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!user || !channel) throw new Error('Not authenticated')
      await getDataProvider().sendChatMessage({
        channel_id: channel.id,
        author_id: user.id,
        content,
      })
    },
    onMutate: async (content: string) => {
      if (!user || !channel) return

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.chatMessages(channelSlug) })

      // Snapshot previous messages from React Query cache
      const previousMessages = queryClient.getQueryData<ChatMessageWithAuthorArray>(queryKeys.chatMessages(channelSlug))

      // Snapshot previous local messages state
      const previousLocalMessages = [...messages]

      // Build a temporary optimistic message
      const tempId = `temp-${Date.now()}`
      const now = new Date().toISOString()
      const authorProfile: Profile = profile || {
        id: user.id,
        username: user.username || user.email.split('@')[0],
        display_name: user.username || user.email.split('@')[0],
        avatar_url: user.avatar || null,
        bio: null,
        website: null,
        is_admin: false,
        forumline_id: null,
        created_at: now,
        updated_at: now,
      }

      const optimisticCacheMessage: ChatMessageWithAuthor = {
        id: tempId,
        channel_id: channel.id,
        author_id: user.id,
        content,
        created_at: now,
        author: authorProfile,
      }

      // Update React Query cache
      queryClient.setQueryData<ChatMessageWithAuthorArray>(
        queryKeys.chatMessages(channelSlug),
        (old = []) => [...old, optimisticCacheMessage]
      )

      // Also update local messages state for immediate display
      const optimisticLocalMsg: ChatMsg = toMsg({
        id: tempId,
        channel_id: channel.id,
        author_id: user.id,
        content,
        created_at: now,
        author: authorProfile,
      })
      setMessages(prev => [...prev, optimisticLocalMsg])

      // Clear input immediately
      setInputValue('')

      return { previousMessages, previousLocalMessages }
    },
    onError: (error, _content, context) => {
      toast.error('Failed to send message')
      console.error('[FLD:Chat] Failed to send message:', error)
      // Roll back React Query cache
      if (context?.previousMessages) {
        queryClient.setQueryData(queryKeys.chatMessages(channelSlug), context.previousMessages)
      }
      // Roll back local messages state
      if (context?.previousLocalMessages) {
        setMessages(context.previousLocalMessages)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(channelSlug) })
    },
  })

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || !user || !channel) return
    sendMutation.mutate(inputValue.trim())
  }

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: ChatMsg[] }[] = []
    messages.forEach(msg => {
      const date = formatDateLabel(msg.createdAt)
      const lastGroup = groups[groups.length - 1]
      if (lastGroup && lastGroup.date === date) {
        lastGroup.messages.push(msg)
      } else {
        groups.push({ date, messages: [msg] })
      }
    })
    return groups
  }, [messages])

  return (
    <div className="chat-page-wrapper flex flex-col overflow-hidden">
      {/* Channel Header */}
      <div className="shrink-0 flex items-center gap-3 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl text-green-400">#</span>
          <h1 className="text-lg font-semibold text-white">{channel?.name || channelSlug}</h1>
        </div>
        {channel?.description && (
          <>
            <div className="hidden h-6 w-px bg-slate-700 sm:block" />
            <p className="hidden text-sm text-slate-400 sm:block">{channel.description}</p>
          </>
        )}
      </div>

      {/* Messages Area */}
      <div role="log" aria-live="polite" aria-label="Chat messages" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div className="space-y-6 py-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-3 px-2">
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-baseline gap-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                  <Skeleton className={`h-4 ${i % 3 === 0 ? 'w-3/4' : i % 3 === 1 ? 'w-1/2' : 'w-5/6'}`} />
                  {i % 2 === 0 && <Skeleton className="h-4 w-2/5" />}
                </div>
              </div>
            ))}
          </div>
        )}
        {isError && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <svg className="mx-auto h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="mt-2 text-slate-400">Failed to load messages</p>
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(channelSlug) })}
                className="mt-2 text-sm text-indigo-400 hover:text-indigo-300"
              >
                Try again
              </button>
            </div>
          </div>
        )}
        {groupedMessages.map((group) => (
          <div key={group.date}>
            {/* Date Divider */}
            <div className="relative my-4 flex items-center">
              <div className="flex-1 border-t border-slate-700" />
              <span className="mx-4 text-xs font-medium text-slate-500">{group.date}</span>
              <div className="flex-1 border-t border-slate-700" />
            </div>

            {/* Messages */}
            {group.messages.map((message, idx) => {
              const prevMessage = group.messages[idx - 1]
              const isGrouped = prevMessage &&
                prevMessage.authorId === message.authorId &&
                new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime() < 300000

              return (
                <div
                  key={message.id}
                  className={`group flex gap-3 px-2 py-0.5 hover:bg-slate-800/50 rounded ${
                    isGrouped ? 'mt-0' : 'mt-4'
                  }`}
                >
                  {/* Avatar or spacer */}
                  {isGrouped ? (
                    <div className="w-10 shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <span className="text-[10px] text-slate-500">{formatTime(message.createdAt)}</span>
                    </div>
                  ) : (
                    <Avatar seed={message.authorId} type="user" avatarUrl={message.authorAvatarUrl} size={40} className="h-10 w-10 shrink-0" showGlobe={!!message.authorForumlineId} />
                  )}

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    {!isGrouped && (
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-white">{message.authorName}</span>
                        <span className="text-xs text-slate-500">{formatTime(message.createdAt)}</span>
                      </div>
                    )}
                    <p className="text-slate-300 break-words">{message.content}</p>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="shrink-0 border-t border-slate-700 px-3 py-3 sm:px-4 sm:py-4">
        {!user ? (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-slate-700/50 px-4 py-3">
            <span className="text-slate-400">Sign in to chat</span>
            <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">
              Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSend}>
            <div className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={`Message #${channel?.name || channelSlug}`}
                aria-label={`Message #${channel?.name || channelSlug}`}
                className="flex-1 bg-transparent text-white placeholder-slate-400 outline-none"
              />
              <button
                type="submit"
                disabled={!inputValue.trim()}
                className="shrink-0 text-slate-400 hover:text-indigo-400 disabled:opacity-50 disabled:hover:text-slate-400"
                aria-label="Send message"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
