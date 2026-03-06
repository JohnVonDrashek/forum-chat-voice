import { useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSSE } from '../../lib/sse'
import { queryKeys } from '../../lib/queries'
import Avatar from '../Avatar'
import Card from '../ui/Card'
import { formatDate } from '../../lib/dateFormatters'
import type { PostWithAuthor, ThreadWithAuthor } from '../../types'

const POSTS_PER_PAGE = 5

interface PostListProps {
  thread: ThreadWithAuthor
  posts: PostWithAuthor[]
  currentPage: number
  totalPages: number
  pendingPosts: PostWithAuthor[]
  autoUpdate: boolean
  onSetPendingPosts: React.Dispatch<React.SetStateAction<PostWithAuthor[]>>
  onSetAutoUpdate: (checked: boolean) => void
  onSetReplyingTo: (post: PostWithAuthor) => void
  onGoToPage: (page: number) => void
}

export default function PostList({
  thread,
  posts,
  currentPage,
  totalPages,
  pendingPosts,
  autoUpdate,
  onSetPendingPosts,
  onSetAutoUpdate,
  onSetReplyingTo,
  onGoToPage,
}: PostListProps) {
  const queryClient = useQueryClient()
  const pendingPostsRef = useRef<PostWithAuthor[]>([])
  const autoUpdateRef = useRef(false)

  // Keep refs in sync so subscription callbacks see latest values
  pendingPostsRef.current = pendingPosts
  autoUpdateRef.current = autoUpdate

  const paginatedPosts = posts.slice(
    (currentPage - 1) * POSTS_PER_PAGE,
    currentPage * POSTS_PER_PAGE
  )

  // Set up SSE subscription for new posts
  const sseUrl = `/api/threads/${thread.id}/stream`
  const handleSSE = useCallback((data: unknown) => {
    const post = data as PostWithAuthor
    if (!post?.id) return

    const threadId = thread.id
    const currentPosts = queryClient.getQueryData<PostWithAuthor[]>(queryKeys.posts(threadId)) ?? []
    const known = currentPosts.some(p => p.id === post.id)
      || pendingPostsRef.current.some(p => p.id === post.id)
    if (known) return

    if (autoUpdateRef.current) {
      queryClient.setQueryData<PostWithAuthor[]>(
        queryKeys.posts(threadId),
        (old = []) => old.some(p => p.id === post.id) ? old : [...old, post]
      )
    } else {
      onSetPendingPosts(prev => {
        if (prev.some(p => p.id === post.id)) return prev
        return [...prev, post]
      })
    }
  }, [thread.id, queryClient, onSetPendingPosts])
  useSSE(sseUrl, handleSSE)

  const loadPendingPosts = useCallback(() => {
    if (pendingPosts.length === 0) return
    queryClient.setQueryData<PostWithAuthor[]>(
      queryKeys.posts(thread.id),
      (old = []) => {
        const existingIds = new Set(old.map(p => p.id))
        const toAdd = pendingPosts.filter(p => !existingIds.has(p.id))
        return toAdd.length > 0 ? [...old, ...toAdd] : old
      }
    )
    onSetPendingPosts([])
  }, [pendingPosts, thread.id, queryClient, onSetPendingPosts])

  const handleAutoUpdateToggle = useCallback((checked: boolean) => {
    onSetAutoUpdate(checked)
    if (checked) {
      // Immediately merge any buffered posts
      loadPendingPosts()
    }
  }, [loadPendingPosts, onSetAutoUpdate])

  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = []

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)

      if (currentPage > 3) {
        pages.push('ellipsis')
      }

      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)

      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i)
      }

      if (currentPage < totalPages - 2) {
        pages.push('ellipsis')
      }

      if (!pages.includes(totalPages)) pages.push(totalPages)
    }

    return pages
  }

  return (
    <>
      {/* Posts */}
      <div className="space-y-4">
        {paginatedPosts.map((post) => {
          const replyToPost = post.reply_to_id ? posts.find(p => p.id === post.reply_to_id) : null
          const isOP = post.author_id === thread.author_id

          return (
            <Card key={post.id}>
              {/* Reply-to indicator */}
              {replyToPost && (
                <div className="flex items-center gap-2 border-b border-slate-700/50 px-4 py-2 text-sm">
                  <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  <span className="text-slate-500">Replying to</span>
                  <span className="font-medium text-slate-400">{replyToPost.author.display_name || replyToPost.author.username}</span>
                </div>
              )}

              <div className="flex gap-4 p-4">
                {/* Author */}
                <div className="hidden shrink-0 sm:block">
                  <Avatar seed={post.author.id} type="user" avatarUrl={post.author.avatar_url} size={48} showGlobe={!!post.author.forumline_id} />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Mobile avatar */}
                    <div className="sm:hidden">
                      <Avatar seed={post.author.id} type="user" avatarUrl={post.author.avatar_url} size={24} showGlobe={!!post.author.forumline_id} />
                    </div>
                    <span className="font-medium text-white">
                      {post.author.display_name || post.author.username}
                    </span>
                    {isOP && (
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs text-indigo-400">
                        OP
                      </span>
                    )}
                    <span className="text-xs text-slate-500 sm:text-sm">
                      {formatDate(post.created_at)}
                    </span>
                  </div>
                  <div className="mt-3 text-slate-300">
                    {post.content.split('\n').map((line, i) => (
                      <p key={i} className="mb-2 last:mb-0">{line || <br />}</p>
                    ))}
                  </div>

                  {/* Actions */}
                  {!thread.is_locked && (
                    <div className="mt-3 flex items-center gap-4">
                      <button
                        onClick={() => onSetReplyingTo(post)}
                        className="flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-400 transition-colors"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                        Reply
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <nav aria-label="Thread pagination" className="mt-6 flex items-center justify-center gap-1">
          {/* Previous */}
          <button
            onClick={() => onGoToPage(currentPage - 1)}
            disabled={currentPage === 1}
            aria-label="Previous page"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Page numbers */}
          {getPageNumbers().map((page, index) =>
            page === 'ellipsis' ? (
              <span key={`ellipsis-${index}`} className="px-2 text-slate-500">...</span>
            ) : (
              <button
                key={page}
                onClick={() => onGoToPage(page)}
                aria-label={`Page ${page}`}
                aria-current={page === currentPage ? 'page' : undefined}
                className={`min-w-[2.5rem] rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  page === currentPage
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {page}
              </button>
            )
          )}

          {/* Next */}
          <button
            onClick={() => onGoToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            aria-label="Next page"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </nav>
      )}

      {/* Live updates bar */}
      <div className={`mt-4 flex items-center justify-between rounded-lg border px-4 py-2.5 ${
          pendingPosts.length > 0
            ? 'border-indigo-500/30 bg-indigo-500/10'
            : 'border-slate-700 bg-slate-800/50'
        }`}>
          <div className="flex items-center gap-2">
            {pendingPosts.length > 0 ? (
              <>
                <svg className="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                <span className="text-sm text-indigo-300">
                  {pendingPosts.length} new {pendingPosts.length === 1 ? 'reply' : 'replies'} available
                </span>
                <button
                  onClick={loadPendingPosts}
                  className="ml-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
                >
                  Load
                </button>
              </>
            ) : (
              <span className="text-xs text-slate-500">
                {autoUpdate ? 'Auto-updating replies' : 'Live updates enabled'}
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={(e) => handleAutoUpdateToggle(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
            />
            Auto-update
          </label>
        </div>
    </>
  )
}
