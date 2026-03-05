import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAuth } from '../../lib/auth'
import { getDataProvider } from '../../lib/data-provider'
import { queryKeys } from '../../lib/queries'
import Button from '../ui/Button'
import Card from '../ui/Card'
import type { PostWithAuthor, ThreadWithAuthor, Profile } from '../../types'

const POSTS_PER_PAGE = 5

interface ReplyComposerProps {
  thread: ThreadWithAuthor
  currentPage: number
  replyingTo: PostWithAuthor | null
  onSetReplyingTo: (post: PostWithAuthor | null) => void
  onGoToPage: (page: number) => void
}

export default function ReplyComposer({
  thread,
  currentPage,
  replyingTo,
  onSetReplyingTo,
  onGoToPage,
}: ReplyComposerProps) {
  const { user, profile } = useAuth()
  const queryClient = useQueryClient()
  const [replyContent, setReplyContent] = useState('')

  // Reply mutation with optimistic update
  const replyMutation = useMutation({
    mutationFn: async ({ content, replyToId }: { content: string; replyToId: string | null }) => {
      if (!thread || !user) throw new Error('Not authenticated')
      const dp = getDataProvider()
      const result = await dp.createPost({
        thread_id: thread.id,
        author_id: user.id,
        content,
        reply_to_id: replyToId || undefined,
      })
      if (!result) throw new Error('Failed to create post')
      // Re-fetch the post with author data
      const fetchedPosts = await dp.getPosts(thread.id)
      const insertedPost = fetchedPosts.find(p => p.id === result.id)
      if (!insertedPost) throw new Error('Post created but not found')
      return insertedPost
    },
    onMutate: async ({ content, replyToId }) => {
      if (!thread || !user) return

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.posts(thread.id) })

      // Snapshot previous posts
      const previousPosts = queryClient.getQueryData<PostWithAuthor[]>(queryKeys.posts(thread.id))

      // Build a temporary optimistic post
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

      const optimisticPost: PostWithAuthor = {
        id: tempId,
        thread_id: thread.id,
        author_id: user.id,
        content,
        reply_to_id: replyToId,
        created_at: now,
        updated_at: now,
        author: authorProfile,
      }

      // Optimistically add the post
      queryClient.setQueryData<PostWithAuthor[]>(
        queryKeys.posts(thread.id),
        (old = []) => {
          const updated = [...old, optimisticPost]
          // Navigate to last page to see the new post
          const newTotalPages = Math.ceil(updated.length / POSTS_PER_PAGE)
          if (newTotalPages > currentPage) {
            setTimeout(() => onGoToPage(newTotalPages), 0)
          }
          return updated
        }
      )

      // Clear the form immediately for instant feel
      setReplyContent('')
      onSetReplyingTo(null)

      return { previousPosts }
    },
    onError: (error, _variables, context) => {
      toast.error('Failed to post reply')
      console.error('[FLD:Thread] Failed to post reply:', error)
      if (!thread) return
      // Roll back to previous posts
      if (context?.previousPosts) {
        queryClient.setQueryData(queryKeys.posts(thread.id), context.previousPosts)
      }
    },
    onSuccess: (insertedPost) => {
      if (!thread) return

      // Replace the temp post with the real one from the server
      queryClient.setQueryData<PostWithAuthor[]>(
        queryKeys.posts(thread.id),
        (old = []) => old.map(p => p.id.startsWith('temp-') ? insertedPost : p)
      )

      // Update thread's last_post_at
      getDataProvider().updateThread(thread.id, {
        last_post_at: new Date().toISOString(),
        post_count: thread.post_count + 1,
      }).catch((updateError) => {
        console.error('[FLD:Thread] Failed to update thread after reply:', updateError)
      })
    },
    onSettled: () => {
      if (!thread) return
      // Invalidate to get the real data and update related caches
      queryClient.invalidateQueries({ queryKey: queryKeys.posts(thread.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.threads(20) })
    },
  })

  const handleReply = (e: React.FormEvent) => {
    e.preventDefault()
    if (!thread || !replyContent.trim() || !user) return
    replyMutation.mutate({ content: replyContent.trim(), replyToId: replyingTo?.id || null })
  }

  if (thread.is_locked) {
    return (
      <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-center text-slate-400">
        This thread is locked. No new replies can be posted.
      </div>
    )
  }

  if (!user) {
    return (
      <Card className="mt-6 p-4 text-center">
        <p className="text-slate-400">
          <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">Sign in</Link> to reply to this thread
        </p>
      </Card>
    )
  }

  return (
    <form onSubmit={handleReply} className="mt-6">
      <Card>
        {/* Reply-to indicator */}
        {replyingTo && (
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2">
            <div className="flex items-center gap-2 text-sm">
              <svg className="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span className="text-slate-400">Replying to</span>
              <span className="font-medium text-white">{replyingTo.author.display_name || replyingTo.author.username}</span>
            </div>
            <button
              type="button"
              onClick={() => onSetReplyingTo(null)}
              className="text-slate-500 hover:text-white"
              aria-label="Cancel reply"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="p-4">
          <textarea
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            placeholder={replyingTo ? `Reply to ${replyingTo.author.display_name || replyingTo.author.username}...` : "Write your reply..."}
            aria-label={replyingTo ? `Reply to ${replyingTo.author.display_name || replyingTo.author.username}` : "Write your reply"}
            rows={4}
            className="block w-full resize-none rounded-lg border border-slate-600 bg-slate-700 px-4 py-3 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="mt-3 flex justify-end">
            <Button
              type="submit"
              disabled={replyMutation.isPending || !replyContent.trim()}
            >
              {replyMutation.isPending ? 'Posting...' : 'Post Reply'}
            </Button>
          </div>
        </div>
      </Card>
    </form>
  )
}
