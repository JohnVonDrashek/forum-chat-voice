import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase, isConfigured } from '../lib/supabase'
import type { Profile } from '../types'

interface Conversation {
  id: string
  recipientId: string
  recipientName: string
  recipientAvatar: string
  lastMessage: string
  lastMessageTime: Date
  unreadCount: number
}

interface DM {
  id: string
  senderId: string
  content: string
  timestamp: Date
}

// Demo conversations
const demoConversations: Conversation[] = [
  {
    id: 'sarah',
    recipientId: '2',
    recipientName: 'Sarah',
    recipientAvatar: 'S',
    lastMessage: "That sounds great! Let me know when you're ready.",
    lastMessageTime: new Date(Date.now() - 300000),
    unreadCount: 2,
  },
  {
    id: 'mike',
    recipientId: '3',
    recipientName: 'Mike',
    recipientAvatar: 'M',
    lastMessage: 'Thanks for the help with the voice rooms!',
    lastMessageTime: new Date(Date.now() - 3600000),
    unreadCount: 0,
  },
  {
    id: 'alex',
    recipientId: '4',
    recipientName: 'Alex',
    recipientAvatar: 'A',
    lastMessage: 'Did you see the new update?',
    lastMessageTime: new Date(Date.now() - 86400000),
    unreadCount: 0,
  },
  {
    id: 'emma',
    recipientId: '6',
    recipientName: 'Emma',
    recipientAvatar: 'E',
    lastMessage: "I'll send over the API docs tomorrow.",
    lastMessageTime: new Date(Date.now() - 172800000),
    unreadCount: 0,
  },
]

const demoMessages: Record<string, DM[]> = {
  sarah: [
    { id: '1', senderId: '2', content: 'Hey! How are you doing?', timestamp: new Date(Date.now() - 600000) },
    { id: '2', senderId: 'me', content: "I'm good! Working on the forum project.", timestamp: new Date(Date.now() - 540000) },
    { id: '3', senderId: '2', content: "That's awesome! The voice rooms look really cool.", timestamp: new Date(Date.now() - 480000) },
    { id: '4', senderId: 'me', content: 'Thanks! Want to test them out later?', timestamp: new Date(Date.now() - 420000) },
    { id: '5', senderId: '2', content: "That sounds great! Let me know when you're ready.", timestamp: new Date(Date.now() - 300000) },
  ],
  mike: [
    { id: '1', senderId: 'me', content: 'Hey Mike, the moderation tools are ready!', timestamp: new Date(Date.now() - 7200000) },
    { id: '2', senderId: '3', content: 'Perfect timing! I was just about to ask.', timestamp: new Date(Date.now() - 7000000) },
    { id: '3', senderId: 'me', content: 'You can mute, kick, and ban users now.', timestamp: new Date(Date.now() - 6800000) },
    { id: '4', senderId: '3', content: 'Thanks for the help with the voice rooms!', timestamp: new Date(Date.now() - 3600000) },
  ],
  alex: [
    { id: '1', senderId: '4', content: 'The dark mode looks great!', timestamp: new Date(Date.now() - 172800000) },
    { id: '2', senderId: 'me', content: "Thanks! It's the default now.", timestamp: new Date(Date.now() - 172000000) },
    { id: '3', senderId: '4', content: 'Did you see the new update?', timestamp: new Date(Date.now() - 86400000) },
  ],
  emma: [
    { id: '1', senderId: 'me', content: 'Hey Emma! Any updates on the API?', timestamp: new Date(Date.now() - 259200000) },
    { id: '2', senderId: '6', content: "I'll send over the API docs tomorrow.", timestamp: new Date(Date.now() - 172800000) },
  ],
}

export default function DirectMessages() {
  const { recipientId } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<DM[]>([])
  const [newMessage, setNewMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // New message modal state
  const [showNewMessage, setShowNewMessage] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [searching, setSearching] = useState(false)

  // Fallback profile for new conversations with no prior messages
  const [recipientProfile, setRecipientProfile] = useState<Profile | null>(null)

  const currentConversation = recipientId
    ? conversations.find(c => c.id === recipientId || c.recipientId === recipientId)
    : null

  // Fetch recipient profile when navigating to a new conversation
  useEffect(() => {
    if (!recipientId || !isConfigured || !user || currentConversation) {
      setRecipientProfile(null)
      return
    }

    const fetchRecipient = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', recipientId)
        .single()

      if (data) setRecipientProfile(data)
    }

    fetchRecipient()
  }, [recipientId, user, currentConversation])

  // Debounced user search
  useEffect(() => {
    if (!searchQuery.trim() || !isConfigured) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', user?.id ?? '')
        .or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`)
        .limit(10)

      setSearchResults(data ?? [])
      setSearching(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, user])

  // Fetch conversations
  useEffect(() => {
    if (!isConfigured) {
      setConversations(demoConversations)
      return
    }
    if (!user) return

    const fetchConversations = async () => {
      // Get all DMs involving this user, grouped by the other person
      const { data } = await supabase
        .from('direct_messages')
        .select('*, sender:profiles!direct_messages_sender_id_fkey(*), recipient:profiles!direct_messages_recipient_id_fkey(*)')
        .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .order('created_at', { ascending: false })

      if (!data) return

      // Group by other user
      const convMap = new Map<string, Conversation>()
      for (const dm of data) {
        const other: Profile = dm.sender_id === user.id ? dm.recipient : dm.sender
        if (!convMap.has(other.id)) {
          convMap.set(other.id, {
            id: other.id,
            recipientId: other.id,
            recipientName: other.display_name || other.username,
            recipientAvatar: (other.display_name?.[0] || other.username[0]).toUpperCase(),
            lastMessage: dm.content,
            lastMessageTime: new Date(dm.created_at),
            unreadCount: 0,
          })
        }
      }

      // Count unreads
      const { data: unreads } = await supabase
        .from('direct_messages')
        .select('sender_id')
        .eq('recipient_id', user.id)
        .eq('read', false)

      if (unreads) {
        for (const u of unreads) {
          const conv = convMap.get(u.sender_id)
          if (conv) conv.unreadCount++
        }
      }

      setConversations(Array.from(convMap.values()))
    }

    fetchConversations()

    // Subscribe to new DMs
    const sub = supabase
      .channel('dm-conversations')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        () => fetchConversations()
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [user])

  // Fetch messages for selected conversation
  useEffect(() => {
    if (!recipientId) {
      setMessages([])
      return
    }

    if (!isConfigured) {
      setMessages(demoMessages[recipientId] || [])
      setConversations(prev =>
        prev.map(c => c.id === recipientId ? { ...c, unreadCount: 0 } : c)
      )
      return
    }

    if (!user) return

    const otherId = currentConversation?.recipientId || recipientId

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('direct_messages')
        .select('*')
        .or(`and(sender_id.eq.${user.id},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${user.id})`)
        .order('created_at')

      if (data) {
        setMessages(data.map(dm => ({
          id: dm.id,
          senderId: dm.sender_id,
          content: dm.content,
          timestamp: new Date(dm.created_at),
        })))
      }

      // Mark as read
      await supabase
        .from('direct_messages')
        .update({ read: true })
        .eq('sender_id', otherId)
        .eq('recipient_id', user.id)
        .eq('read', false)

      // Update local unread count
      setConversations(prev =>
        prev.map(c => (c.id === recipientId || c.recipientId === otherId) ? { ...c, unreadCount: 0 } : c)
      )
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
              supabase.from('direct_messages').update({ read: true }).eq('id', dm.id).then(() => {})
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !recipientId) return

    if (isConfigured) {
      if (!user) return
      const otherId = currentConversation?.recipientId || recipientId
      await supabase.from('direct_messages').insert({
        sender_id: user.id,
        recipient_id: otherId,
        content: newMessage.trim(),
      })
      setNewMessage('')
      return
    }

    // Demo mode
    const message: DM = {
      id: Date.now().toString(),
      senderId: 'me',
      content: newMessage.trim(),
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, message])
    setConversations(prev =>
      prev.map(c =>
        c.id === recipientId
          ? { ...c, lastMessage: newMessage.trim(), lastMessageTime: new Date() }
          : c
      )
    )
    setNewMessage('')
  }

  const handleSelectUser = useCallback((profile: Profile) => {
    setShowNewMessage(false)
    setSearchQuery('')
    setSearchResults([])
    navigate(`/dm/${profile.id}`)
  }, [navigate])

  const formatTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    if (hours < 24) return `${hours}h`
    if (days < 7) return `${days}d`
    return date.toLocaleDateString()
  }

  const formatMessageTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  // Auth guard
  if (isConfigured && !authLoading && !user) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <h3 className="mt-4 font-medium text-white">Sign in to view messages</h3>
          <p className="mt-1 text-sm text-slate-400">You need to be logged in to send and receive direct messages.</p>
          <Link to="/login" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Sign In
          </Link>
        </div>
      </div>
    )
  }

  const showConversationList = !recipientId
  const showMessages = !!recipientId

  // The active conversation: either an existing one or built from the fetched recipient profile
  const activeConversation = currentConversation || (recipientProfile ? {
    id: recipientProfile.id,
    recipientId: recipientProfile.id,
    recipientName: recipientProfile.display_name || recipientProfile.username,
    recipientAvatar: (recipientProfile.display_name?.[0] || recipientProfile.username[0]).toUpperCase(),
    lastMessage: '',
    lastMessageTime: new Date(),
    unreadCount: 0,
  } : null)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex h-[calc(100vh-7rem)] overflow-hidden rounded-xl border border-slate-700 bg-slate-800/50">
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
            {conversations.length === 0 ? (
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
                  key={conversation.id}
                  to={`/dm/${conversation.recipientId}`}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-700/50 ${
                    recipientId === conversation.id || recipientId === conversation.recipientId ? 'bg-slate-700/50' : ''
                  }`}
                >
                  <div className="relative">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500 text-sm font-medium text-white">
                      {conversation.recipientAvatar}
                    </div>
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
                        {formatTime(conversation.lastMessageTime)}
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
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-sm font-medium text-white">
                  {activeConversation.recipientAvatar}
                </div>
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
              <div className="border-t border-slate-700 p-4">
                {isConfigured && !user ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg bg-slate-700/50 px-4 py-3">
                    <span className="text-slate-400">Sign in to send messages</span>
                    <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">Sign In</Link>
                  </div>
                ) : (
                  <form onSubmit={handleSend} className="flex gap-2">
                    <input
                      type="text"
                      value={newMessage}
                      onChange={e => setNewMessage(e.target.value)}
                      placeholder={`Message ${activeConversation.recipientName}...`}
                      className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={!newMessage.trim()}
                      className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  </form>
                )}
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
      </div>

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
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by username or display name..."
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-medium text-white">
                    {(profile.display_name?.[0] || profile.username[0]).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-white">
                      {profile.display_name || profile.username}
                    </div>
                    <div className="text-sm text-slate-400">@{profile.username}</div>
                  </div>
                </button>
              ))}
            </div>

            {!isConfigured && (
              <div className="border-t border-slate-700 p-4 text-center text-sm text-slate-500">
                User search requires Supabase connection
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
