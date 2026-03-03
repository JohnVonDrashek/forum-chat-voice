import { useState, useRef, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import Avatar from '../components/Avatar'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'
import { formatTime, formatDateLabel } from '../lib/dateFormatters'
import type { Profile, ChatMessageWithAuthor } from '../types'

interface ChatMsg {
  id: string
  channelId: string
  authorId: string
  authorName: string
  authorAvatar: string
  authorAvatarUrl?: string | null
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
    content: row.content,
    createdAt: row.created_at,
  }
}

export default function Chat() {
  const { channelId: channelSlug = 'general' } = useParams()
  const { user } = useAuth()
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

    console.log('[FCV:Chat] Subscribing to realtime for channel:', channel.slug)
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
            console.error('[FCV:Chat] Failed to fetch new realtime message:', error)
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
        console.log('[FCV:Chat] Subscription status:', status)
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

  const [sendError, setSendError] = useState<string | null>(null)

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || !user || !channel) return
    setSendError(null)

    const { error } = await supabase.from('chat_messages').insert({
      channel_id: channel.id,
      author_id: user.id,
      content: inputValue.trim(),
    })
    if (error) {
      console.error('[FCV:Chat] Failed to send message:', error)
      setSendError('Failed to send message')
      return
    }
    setInputValue('')
  }

  // Group messages by date
  const groupedMessages: { date: string; messages: ChatMsg[] }[] = []
  messages.forEach(msg => {
    const date = formatDateLabel(msg.createdAt)
    const lastGroup = groupedMessages[groupedMessages.length - 1]
    if (lastGroup && lastGroup.date === date) {
      lastGroup.messages.push(msg)
    } else {
      groupedMessages.push({ date, messages: [msg] })
    }
  })

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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-500" />
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
                    <Avatar seed={message.authorId} type="user" avatarUrl={message.authorAvatarUrl} size={40} className="h-10 w-10 shrink-0" />
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
      {sendError && (
        <div className="shrink-0 px-3 sm:px-4">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {sendError}
            <button onClick={() => setSendError(null)} className="ml-2 text-red-300 hover:text-red-200">dismiss</button>
          </div>
        </div>
      )}
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
              <button
                type="button"
                className="shrink-0 text-slate-400 hover:text-slate-300"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </button>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={`Message #${channel?.name || channelSlug}`}
                className="flex-1 bg-transparent text-white placeholder-slate-400 outline-none"
              />
              <button
                type="submit"
                disabled={!inputValue.trim()}
                className="shrink-0 text-slate-400 hover:text-indigo-400 disabled:opacity-50 disabled:hover:text-slate-400"
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
