import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import Avatar from '../components/Avatar'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'
import { formatShortTimeAgo, formatMessageTime } from '../lib/dateFormatters'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'
import type { Profile } from '../types'

interface DM {
  id: string
  senderId: string
  content: string
  timestamp: Date
}

export default function DirectMessages() {
  const { recipientId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<DM[]>([])
  const [newMessage, setNewMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // New message modal state
  const [showNewMessage, setShowNewMessage] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [searching, setSearching] = useState(false)

  // Use React Query for conversations list - cached globally!
  const { data: conversations = [], isError: conversationsError } = useQuery({
    queryKey: queryKeys.dmConversationsList(user?.id ?? ''),
    queryFn: () => fetchers.dmConversations(user!.id),
    enabled: !!user,
    ...queryOptions.realtime,
  })

  const currentConversation = recipientId
    ? conversations.find(c => c.recipientId === recipientId)
    : null

  // Use React Query for recipient profile (for new conversations)
  const { data: recipientProfile } = useQuery({
    queryKey: queryKeys.profile(recipientId ?? ''),
    queryFn: () => fetchers.profile(recipientId!),
    enabled: !!recipientId && !!user && !currentConversation,
    ...queryOptions.profiles,
  })

  // Debounced user search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', user?.id ?? '')
        .or(`username.ilike.*${searchQuery}*,display_name.ilike.*${searchQuery}*`)
        .limit(10)

      setSearchResults(data ?? [])
      setSearching(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, user])

  // Subscribe to new DMs for real-time updates to conversation list
  useEffect(() => {
    if (!user) return

    const sub = supabase
      .channel('dm-conversations')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        () => {
          // Invalidate to refetch conversations
          queryClient.invalidateQueries({ queryKey: queryKeys.dmConversationsList(user.id) })
        }
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [user, queryClient])

  // Fetch messages for selected conversation
  useEffect(() => {
    if (!recipientId) {
      setMessages([])
      return
    }

    if (!user) return

    const otherId = currentConversation?.recipientId || recipientId

    const fetchMessages = async () => {
      console.log('[FCV:DM] Fetching messages for conversation:', otherId)
      const { data, error } = await supabase
        .from('direct_messages')
        .select('*')
        .or(`and(sender_id.eq.${user.id},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${user.id})`)
        .order('created_at')

      if (error) {
        console.error('[FCV:DM] Failed to fetch messages:', error)
        return
      }

      if (data) {
        setMessages(data.map(dm => ({
          id: dm.id,
          senderId: dm.sender_id,
          content: dm.content,
          timestamp: new Date(dm.created_at),
        })))
        console.log('[FCV:DM] Loaded', data.length, 'messages')
      }

      // Mark as read
      const { error: readError } = await supabase
        .from('direct_messages')
        .update({ read: true })
        .eq('sender_id', otherId)
        .eq('recipient_id', user.id)
        .eq('read', false)

      if (readError) {
        console.error('[FCV:DM] Failed to mark messages as read:', readError)
      }

      // Invalidate conversations to update unread count
      queryClient.invalidateQueries({ queryKey: queryKeys.dmConversationsList(user.id) })
    }

    fetchMessages()

    // Subscribe to new messages in this conversation
    const sub = supabase
      .channel(`dm:${otherId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        (payload) => {
          const dm = payload.new as { id: string; sender_id: string; recipient_id: string; content: string; created_at: string }
          const isRelevant =
            (dm.sender_id === user.id && dm.recipient_id === otherId) ||
            (dm.sender_id === otherId && dm.recipient_id === user.id)
          if (isRelevant) {
            setMessages(prev => [...prev, {
              id: dm.id,
              senderId: dm.sender_id,
              content: dm.content,
              timestamp: new Date(dm.created_at),
            }])
            // Mark incoming as read
            if (dm.sender_id === otherId) {
              supabase.from('direct_messages').update({ read: true }).eq('id', dm.id).then(({ error }) => {
                if (error) console.error('[FCV:DM] Failed to mark realtime DM as read:', error)
              })
            }
          }
        }
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [recipientId, user])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const [sendError, setSendError] = useState<string | null>(null)

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !recipientId || !user) return
    setSendError(null)

    const otherId = currentConversation?.recipientId || recipientId
    const { error } = await supabase.from('direct_messages').insert({
      sender_id: user.id,
      recipient_id: otherId,
      content: newMessage.trim(),
    })
    if (error) {
      console.error('[FCV:DM] Failed to send message:', error)
      setSendError('Failed to send message')
      return
    }
    setNewMessage('')
  }

  const handleSelectUser = useCallback((profile: Profile) => {
    setShowNewMessage(false)
    setSearchQuery('')
    setSearchResults([])
    navigate(`/dm/${profile.id}`)
  }, [navigate])

  const showConversationList = !recipientId
  const showMessages = !!recipientId

  // The active conversation: either an existing one or built from the fetched recipient profile
  const activeConversation = currentConversation || (recipientProfile ? {
    recipientId: recipientProfile.id,
    recipientName: recipientProfile.display_name || recipientProfile.username,
    recipientAvatarUrl: recipientProfile.avatar_url,
    lastMessage: '',
    lastMessageTime: new Date().toISOString(),
    unreadCount: 0,
  } : null)

  return (
    <div className="mx-auto max-w-6xl">
      <Card className="flex h-[calc(100vh-7rem)] overflow-hidden">
        {/* Conversation List */}
        <div className={`${showConversationList ? 'flex' : 'hidden'} w-full flex-col border-r border-slate-700 md:flex md:w-80`}>
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <h2 className="font-semibold text-white">Messages</h2>
            <button
              onClick={() => setShowNewMessage(true)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
              title="New message"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversationsError ? (
              <div className="p-4 text-center">
                <p className="text-red-400">Failed to load conversations</p>
                <button
                  onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.dmConversationsList(user!.id) })}
                  className="mt-2 text-sm text-indigo-400 hover:text-indigo-300"
                >
                  Try again
                </button>
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-4 text-center text-slate-400">
                <p>No conversations yet</p>
                <button
                  onClick={() => setShowNewMessage(true)}
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
                    recipientId === conversation.recipientId ? 'bg-slate-700/50' : ''
                  }`}
                >
                  <div className="relative">
                    <Avatar seed={conversation.recipientId} type="user" avatarUrl={conversation.recipientAvatarUrl} size={40} />
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
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Messages */}
        <div className={`${showMessages ? 'flex' : 'hidden'} flex-1 flex-col md:flex`}>
          {activeConversation ? (
            <>
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
                <Link
                  to="/dm"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white md:hidden"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </Link>
                <Avatar seed={activeConversation.recipientId} type="user" avatarUrl={activeConversation.recipientAvatarUrl} size={32} />
                <div>
                  <h3 className="font-medium text-white">{activeConversation.recipientName}</h3>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                  {messages.length === 0 && (
                    <div className="py-12 text-center text-slate-500">
                      <p>No messages yet. Say hello!</p>
                    </div>
                  )}
                  {messages.map(message => {
                    const isMe = message.senderId === 'me' || message.senderId === user?.id
                    return (
                      <div
                        key={message.id}
                        className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`max-w-[75%] ${isMe ? 'order-2' : 'order-1'}`}>
                          <div
                            className={`rounded-2xl px-4 py-2 ${
                              isMe
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-700 text-slate-200'
                            }`}
                          >
                            {message.content}
                          </div>
                          <div className={`mt-1 text-xs text-slate-500 ${isMe ? 'text-right' : 'text-left'}`}>
                            {formatMessageTime(message.timestamp)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Input */}
              {sendError && (
                <div className="mx-4 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {sendError}
                  <button onClick={() => setSendError(null)} className="ml-2 text-red-300 hover:text-red-200">dismiss</button>
                </div>
              )}
              <div className="border-t border-slate-700 p-4">
                <form onSubmit={handleSend} className="flex gap-2">
                    <Input
                      type="text"
                      value={newMessage}
                      onChange={e => setNewMessage(e.target.value)}
                      placeholder={`Message ${activeConversation.recipientName}...`}
                      className="flex-1"
                    />
                    <Button
                      type="submit"
                      disabled={!newMessage.trim()}
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </Button>
                  </form>
              </div>
            </>
          ) : (
            <div className="hidden flex-1 items-center justify-center md:flex">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-700">
                  <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h3 className="font-medium text-white">Your Messages</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Select a conversation or start a new one
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* New Message Modal */}
      {showNewMessage && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => { setShowNewMessage(false); setSearchQuery(''); setSearchResults([]) }}
          />
          <div className="relative w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
              <h3 className="font-semibold text-white">New Message</h3>
              <button
                onClick={() => { setShowNewMessage(false); setSearchQuery(''); setSearchResults([]) }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4">
              <Input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by username or display name..."
                className="w-full"
                autoFocus
              />
            </div>

            <div className="max-h-64 overflow-y-auto">
              {searching && (
                <div className="px-4 py-3 text-center text-sm text-slate-400">Searching...</div>
              )}
              {!searching && searchQuery.trim() && searchResults.length === 0 && (
                <div className="px-4 py-3 text-center text-sm text-slate-400">No users found</div>
              )}
              {searchResults.map(profile => (
                <button
                  key={profile.id}
                  onClick={() => handleSelectUser(profile)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-700/50"
                >
                  <Avatar seed={profile.id} type="user" avatarUrl={profile.avatar_url} size={40} className="shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-white">
                      {profile.display_name || profile.username}
                    </div>
                    <div className="text-sm text-slate-400">@{profile.username}</div>
                  </div>
                </button>
              ))}
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
