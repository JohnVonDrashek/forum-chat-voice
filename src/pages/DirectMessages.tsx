import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { getDataProvider } from '../lib/data-provider'
import Avatar from '../components/Avatar'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'
import Skeleton from '../components/ui/Skeleton'
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

  // Fetch messages for selected conversation via React Query
  const otherId = currentConversation?.recipientId || recipientId
  const { data: rawMessages = [] } = useQuery({
    queryKey: queryKeys.dmMessages(otherId ?? ''),
    queryFn: () => fetchers.dmMessages(user!.id, otherId!),
    enabled: !!recipientId && !!user && !!otherId,
    ...queryOptions.realtime,
  })

  const messages: DM[] = rawMessages.map(dm => ({
    id: dm.id,
    senderId: dm.sender_id,
    content: dm.content,
    timestamp: new Date(dm.created_at),
  }))

  // Mark messages as read when conversation is opened or messages change
  useEffect(() => {
    if (!recipientId || !user || !otherId || rawMessages.length === 0) return

    const markAsRead = async () => {
      try {
        await getDataProvider().markDmsReadFrom(otherId, user.id)
        queryClient.invalidateQueries({ queryKey: queryKeys.dmConversationsList(user.id) })
      } catch (error) {
        console.error('[FCV:DM] Failed to mark messages as read:', error)
      }
    }

    markAsRead()
  }, [recipientId, user, otherId, rawMessages.length, queryClient])

  // Subscribe to new messages in this conversation — invalidate query on new messages
  useEffect(() => {
    if (!recipientId || !user || !otherId) return

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
            // Invalidate to refetch messages
            queryClient.invalidateQueries({ queryKey: queryKeys.dmMessages(otherId) })
            // Mark incoming as read
            if (dm.sender_id === otherId) {
              getDataProvider().markDmRead(dm.id).catch((error) => {
                console.error('[FCV:DM] Failed to mark realtime DM as read:', error)
              })
            }
          }
        }
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [recipientId, user, otherId, queryClient])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!recipientId || !user) throw new Error('Not authenticated')
      const targetId = currentConversation?.recipientId || recipientId
      await getDataProvider().sendDm({
        sender_id: user.id,
        recipient_id: targetId,
        content,
      })
    },
    onMutate: async (content: string) => {
      if (!recipientId || !user || !otherId) return

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.dmMessages(otherId) })

      // Snapshot previous messages
      const previousMessages = queryClient.getQueryData<typeof rawMessages>(queryKeys.dmMessages(otherId))

      // Build a temporary optimistic DM
      const tempId = `temp-${Date.now()}`
      const now = new Date().toISOString()

      const optimisticDM = {
        id: tempId,
        sender_id: user.id,
        recipient_id: otherId,
        content,
        created_at: now,
        read: false,
      }

      // Optimistically add the DM
      queryClient.setQueryData(
        queryKeys.dmMessages(otherId),
        (old: typeof rawMessages = []) => [...old, optimisticDM]
      )

      // Clear input immediately
      setNewMessage('')

      return { previousMessages }
    },
    onError: (error, _content, context) => {
      toast.error('Failed to send message')
      console.error('[FCV:DM] Failed to send message:', error)
      // Roll back to previous messages
      if (context?.previousMessages && otherId) {
        queryClient.setQueryData(queryKeys.dmMessages(otherId), context.previousMessages)
      }
    },
    onSettled: () => {
      if (user) {
        queryClient.invalidateQueries({ queryKey: queryKeys.dmConversationsList(user.id) })
        if (otherId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.dmMessages(otherId) })
        }
      }
    },
  })

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !recipientId || !user) return
    sendMutation.mutate(newMessage.trim())
  }

  const handleSelectUser = useCallback((profile: Profile) => {
    setShowNewMessage(false)
    setSearchQuery('')
    setSearchResults([])
    navigate(`/dm/${profile.id}`)
  }, [navigate])

  // Close new message modal on Escape
  useEffect(() => {
    if (!showNewMessage) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowNewMessage(false)
        setSearchQuery('')
        setSearchResults([])
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showNewMessage])

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
              aria-label="New message"
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
                  aria-label="Back to conversations"
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
              <div role="log" aria-live="polite" aria-label="Direct messages" className="flex-1 overflow-y-auto p-4">
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
              <div className="border-t border-slate-700 p-4">
                <form onSubmit={handleSend} className="flex gap-2">
                    <Input
                      type="text"
                      value={newMessage}
                      onChange={e => setNewMessage(e.target.value)}
                      placeholder={`Message ${activeConversation.recipientName}...`}
                      aria-label={`Message ${activeConversation.recipientName}`}
                      className="flex-1"
                    />
                    <Button
                      type="submit"
                      disabled={!newMessage.trim()}
                      aria-label="Send message"
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
            aria-hidden="true"
          />
          <div role="dialog" aria-modal="true" aria-labelledby="new-message-title" className="relative w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
              <h3 id="new-message-title" className="font-semibold text-white">New Message</h3>
              <button
                onClick={() => { setShowNewMessage(false); setSearchQuery(''); setSearchResults([]) }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
                aria-label="Close dialog"
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
                aria-label="Search users"
                className="w-full"
                autoFocus
              />
            </div>

            <div className="max-h-64 overflow-y-auto">
              {searching && (
                <div className="space-y-1">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <Skeleton className={`h-4 ${i % 2 === 0 ? 'w-28' : 'w-20'}`} />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                  ))}
                </div>
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
