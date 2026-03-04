import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../Avatar'
import { formatMessageTime } from '../../lib/dateFormatters'

interface DM {
  id: string
  senderId: string
  content: string
  timestamp: Date
}

interface MessageThreadProps {
  recipientId: string
  recipientName: string
  recipientAvatarUrl?: string | null
  messages: DM[]
  hubUserId: string | null
  visible: boolean
}

export default function MessageThread({ recipientId, recipientName, recipientAvatarUrl, messages, hubUserId, visible }: MessageThreadProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (!visible) {
    return (
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
    )
  }

  return (
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
          avatarUrl={recipientAvatarUrl}
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
    </>
  )
}
