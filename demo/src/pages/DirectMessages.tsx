import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useHub } from '@johnvondrashek/forumline-react'
import Card from '../components/ui/Card'
import { supabase } from '../lib/supabase'
import { queryKeys, queryOptions } from '../lib/queries'
import type { HubProfile } from '@johnvondrashek/forumline-protocol'
import ConversationList from '../components/dm/ConversationList'
import MessageThread from '../components/dm/MessageThread'
import MessageComposer from '../components/dm/MessageComposer'
import NewConversationModal from '../components/dm/NewConversationModal'

export default function DirectMessages() {
  const { recipientId } = useParams()
  const navigate = useNavigate()
  const { hubClient, hubSupabase, hubUserId, isHubConnected } = useHub()
  const queryClient = useQueryClient()
  const [newMessage, setNewMessage] = useState('')
  const [showNewMessage, setShowNewMessage] = useState(false)

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

  const messages = hubRawMessages.map(dm => ({
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
    navigate(`/dm/${profile.id}`)
  }, [navigate])

  const recipientName = currentConversation?.recipientName || 'User'

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
            <button
              onClick={async () => {
                const { data: { session } } = await supabase.auth.getSession()
                if (!session?.access_token) {
                  toast.error('Session expired. Please sign in again.')
                  return
                }
                window.location.href = `/api/forumline/auth?link_token=${session.access_token}`
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              Connect to Forumline
            </button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Card className="flex h-[calc(100vh-7rem)] overflow-hidden">
        <ConversationList
          conversations={hubConversations}
          activeRecipientId={recipientId}
          visible={!recipientId}
          onNewMessage={() => setShowNewMessage(true)}
        />

        <div className={`${recipientId ? 'flex' : 'hidden'} flex-1 flex-col md:flex`}>
          <MessageThread
            recipientId={recipientId ?? ''}
            recipientName={recipientName}
            recipientAvatarUrl={currentConversation?.recipientAvatarUrl}
            messages={messages}
            hubUserId={hubUserId}
            visible={!!recipientId}
          />
          {recipientId && (
            <MessageComposer
              recipientName={recipientName}
              value={newMessage}
              onChange={setNewMessage}
              onSubmit={handleSend}
            />
          )}
        </div>
      </Card>

      {showNewMessage && (
        <NewConversationModal
          hubClient={hubClient}
          onSelectUser={handleSelectHubUser}
          onClose={() => setShowNewMessage(false)}
        />
      )}
    </div>
  )
}
