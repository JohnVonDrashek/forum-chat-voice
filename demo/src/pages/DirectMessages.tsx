import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useHub } from '@forumline/react'
import Avatar from '../components/Avatar'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'
import Skeleton from '../components/ui/Skeleton'
import { formatShortTimeAgo, formatMessageTime } from '../lib/dateFormatters'
import { queryKeys, queryOptions } from '../lib/queries'
import type { HubProfile } from '@forumline/protocol'

interface DM {
  id: string
  senderId: string
  content: string
  timestamp: Date
}

export default function DirectMessages() {
  const { recipientId } = useParams()
  const navigate = useNavigate()
  const { hubClient, hubSupabase, hubUserId, isHubConnected } = useHub()
  const queryClient = useQueryClient()
  const [newMessage, setNewMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // New message modal state
  const [showNewMessage, setShowNewMessage] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [hubSearchResults, setHubSearchResults] = useState<HubProfile[]>([])
  const [searching, setSearching] = useState(false)

  // ===== CONNECTION GATE =====
  if (!isHubConnected) {
    return (
      <div className="mx-auto max-w-6xl">
        <Card className="flex h-[calc(100vh-7rem)] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-700">
              <svg className="h-8 w-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </div>
            <h3 className="font-medium text-white">Connect to Forumline</h3>
            <p className="mt-2 max-w-sm text-sm text-slate-400">
              Direct messages are powered by Forumline, enabling cross-forum conversations. Connect your account to get started.
            </p>
            <a
              href="/api/forumline/auth"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              Connect to Forumline
            </a>
          </div>
        </Card>
      </div>
    )
  }

  // ===== HUB CONVERSATIONS =====
  const { data: hubConversations = [] } = useQuery({
    queryKey: queryKeys.hubDmConversations,
    queryFn: () => hubClient!.getConversations(),
    enabled: !!hubClient,
    ...queryOptions.realtime,
  })

  const currentConversation = recipientId
    ? hubConversations.find(c => c.recipientId === recipientId)
    : null

  // ===== USER SEARCH =====
  useEffect(() => {
    if (!searchQuery.trim() || !hubClient) {
      setHubSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await hubClient.searchProfiles(searchQuery)
        setHubSearchResults(results)
      } catch (err) {
        console.error('[FLD:DM] Hub profile search failed:', err)
        setHubSearchResults([])
      }
      setSearching(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, hubClient])

  // ===== REALTIME: HUB =====
  useEffect(() => {
    if (!hubSupabase) return

    const sub = hubSupabase
      .channel('hub-dm-conversations')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hub_direct_messages' },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.hubDmConversations })
          if (recipientId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.hubDmMessages(recipientId) })
          }
        }
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [hubSupabase, queryClient, recipientId])

  // ===== MESSAGES =====
  const { data: hubRawMessages = [] } = useQuery({
    queryKey: queryKeys.hubDmMessages(recipientId ?? ''),
    queryFn: () => hubClient!.getMessages(recipientId!),
    enabled: !!recipientId && !!hubClient,
    ...queryOptions.realtime,
  })

  const messages: DM[] = hubRawMessages.map(dm => ({
    id: dm.id,
    senderId: dm.sender_id,
    content: dm.content,
    timestamp: new Date(dm.created_at),
  }))

  // ===== MARK READ =====
  useEffect(() => {
    if (!recipientId || !hubClient || hubRawMessages.length === 0) return

    hubClient.markRead(recipientId).then(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.hubDmConversations })
    }).catch(error => {
      console.error('[FLD:DM] Failed to mark messages as read:', error)
    })
  }, [recipientId, hubClient, hubRawMessages.length, queryClient])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // ===== SEND MUTATION =====
  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!recipientId || !hubClient) throw new Error('Not connected')
      await hubClient.sendMessage(recipientId, content)
    },
    onMutate: async (content: string) => {
      if (!recipientId) return

      const queryKey = queryKeys.hubDmMessages(recipientId)
      await queryClient.cancelQueries({ queryKey })
      const previousMessages = queryClient.getQueryData<typeof hubRawMessages>(queryKey)

      const optimisticDM = {
        id: `temp-${Date.now()}`,
        sender_id: hubUserId || '',
        recipient_id: recipientId,
        content,
        created_at: new Date().toISOString(),
        read: false,
      }

      queryClient.setQueryData(
        queryKey,
        (old: typeof hubRawMessages = []) => [...old, optimisticDM]
      )

      setNewMessage('')
      return { previousMessages, queryKey }
    },
    onError: (error, _content, context) => {
      toast.error('Failed to send message')
      console.error('[FLD:DM] Failed to send message:', error)
      if (context?.previousMessages && context.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousMessages)
      }
    },
    onSettled: () => {
      if (recipientId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.hubDmConversations })
        queryClient.invalidateQueries({ queryKey: queryKeys.hubDmMessages(recipientId) })
      }
    },
  })

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !recipientId) return
    sendMutation.mutate(newMessage.trim())
  }

  const handleSelectHubUser = useCallback((profile: HubProfile) => {
    setShowNewMessage(false)
    setSearchQuery('')
    setHubSearchResults([])
    navigate(`/dm/${profile.id}`)
  }, [navigate])

  // Close new message modal on Escape
  useEffect(() => {
    if (!showNewMessage) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowNewMessage(false)
        setSearchQuery('')
        setHubSearchResults([])
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showNewMessage])

  const showConversationList = !recipientId
  const showMessages = !!recipientId

  const recipientName = currentConversation?.recipientName || 'User'

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
            {hubConversations.length === 0 ? (
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
              hubConversations.map(conversation => (
                <Link
                  key={conversation.recipientId}
                  to={`/dm/${conversation.recipientId}`}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-700/50 ${
                    recipientId === conversation.recipientId ? 'bg-slate-700/50' : ''
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

        {/* Messages */}
        <div className={`${showMessages ? 'flex' : 'hidden'} flex-1 flex-col md:flex`}>
          {recipientId ? (
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
                <Avatar
                  seed={recipientId}
                  type="user"
                  avatarUrl={currentConversation?.recipientAvatarUrl}
                  size={32}
                  showGlobe
                />
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-white">{recipientName}</h3>
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
                    const isMe = message.senderId === hubUserId
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
                      placeholder={`Message ${recipientName}...`}
                      aria-label={`Message ${recipientName}`}
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
            onClick={() => { setShowNewMessage(false); setSearchQuery(''); setHubSearchResults([]) }}
            aria-hidden="true"
          />
          <div role="dialog" aria-modal="true" aria-labelledby="new-message-title" className="relative w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
              <h3 id="new-message-title" className="font-semibold text-white">New Message</h3>
              <button
                onClick={() => { setShowNewMessage(false); setSearchQuery(''); setHubSearchResults([]) }}
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
                placeholder="Search Forumline users..."
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

              {!searching && searchQuery.trim() && hubSearchResults.length === 0 && (
                <div className="px-4 py-3 text-center text-sm text-slate-400">No Forumline users found</div>
              )}
              {hubSearchResults.map(profile => (
                <button
                  key={profile.id}
                  onClick={() => handleSelectHubUser(profile)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-700/50"
                >
                  <Avatar seed={profile.id} type="user" avatarUrl={profile.avatar_url} size={40} className="shrink-0" showGlobe />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium text-white">
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
