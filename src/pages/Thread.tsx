import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { uploadAvatar } from '../lib/avatars'
import Avatar from '../components/Avatar'
import ImageCropModal from '../components/ImageCropModal'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'
import { formatDate } from '../lib/dateFormatters'
import type { PostWithAuthor } from '../types'

const POSTS_PER_PAGE = 5

export default function Thread() {
  const { threadId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Use React Query for thread - instant on back navigation!
  const { data: thread, isLoading: threadLoading, isError: threadError } = useQuery({
    queryKey: queryKeys.thread(threadId!),
    queryFn: () => fetchers.thread(threadId!),
    ...queryOptions.threads,
    enabled: !!threadId,
  })

  // Use React Query for posts - instant on back navigation!
  const { data: posts = [], isLoading: postsLoading, isError: postsError } = useQuery({
    queryKey: queryKeys.posts(threadId!),
    queryFn: () => fetchers.posts(threadId!),
    ...queryOptions.posts,
    enabled: !!threadId,
  })

  const loading = threadLoading || postsLoading
  const hasError = threadError || postsError

  const [replyContent, setReplyContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyingTo, setReplyingTo] = useState<PostWithAuthor | null>(null)
  const [isBookmarked, setIsBookmarked] = useState(false)
  const [pendingPosts, setPendingPosts] = useState<PostWithAuthor[]>([])
  const [autoUpdate, setAutoUpdate] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const threadImageInputRef = useRef<HTMLInputElement>(null)
  const pendingPostsRef = useRef<PostWithAuthor[]>([])
  const autoUpdateRef = useRef(false)

  // Keep refs in sync so subscription callbacks see latest values
  pendingPostsRef.current = pendingPosts
  autoUpdateRef.current = autoUpdate

  const currentPage = parseInt(searchParams.get('page') || '1', 10)
  const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE)
  const paginatedPosts = posts.slice(
    (currentPage - 1) * POSTS_PER_PAGE,
    currentPage * POSTS_PER_PAGE
  )

  const goToPage = (page: number) => {
    if (page === 1) {
      searchParams.delete('page')
    } else {
      searchParams.set('page', page.toString())
    }
    setSearchParams(searchParams, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Set up real-time subscription for new posts
  useEffect(() => {
    if (!threadId) return

    console.log('[FCV:Thread] Subscribing to realtime for thread:', threadId)
    const subscription = supabase
        .channel(`thread:${threadId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'posts', filter: `thread_id=eq.${threadId}` },
          async (payload) => {
            // Fetch the new post with author
            const { data, error } = await supabase
              .from('posts')
              .select('*, author:profiles(*)')
              .eq('id', payload.new.id)
              .single()
            if (error) {
              console.error('[FCV:Thread] Failed to fetch new realtime post:', error)
              return
            }
            if (data) {
              const post = data as PostWithAuthor
              const currentPosts = queryClient.getQueryData<PostWithAuthor[]>(queryKeys.posts(threadId)) ?? []
              const known = currentPosts.some(p => p.id === post.id)
                || pendingPostsRef.current.some(p => p.id === post.id)
              if (known) return

              if (autoUpdateRef.current) {
                // Add directly to cache
                queryClient.setQueryData<PostWithAuthor[]>(
                  queryKeys.posts(threadId),
                  (old = []) => old.some(p => p.id === post.id) ? old : [...old, post]
                )
              } else {
                // Buffer in pending posts
                setPendingPosts(prev => {
                  if (prev.some(p => p.id === post.id)) return prev
                  return [...prev, post]
                })
              }
            }
          }
        )
        .subscribe((status) => {
          console.log('[FCV:Thread] Subscription status:', status)
        })

    return () => {
      subscription.unsubscribe()
    }
  }, [threadId, queryClient])

  // Check bookmark status
  useEffect(() => {
    if (!thread || !user) return

    supabase
      .from('bookmarks')
      .select('id')
      .eq('user_id', user.id)
      .eq('thread_id', thread.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('[FCV:Thread] Failed to check bookmark status:', error)
          return
        }
        setIsBookmarked(!!data)
      })
  }, [thread?.id, user])

  const loadPendingPosts = useCallback(() => {
    if (pendingPosts.length === 0 || !threadId) return
    queryClient.setQueryData<PostWithAuthor[]>(
      queryKeys.posts(threadId),
      (old = []) => {
        const existingIds = new Set(old.map(p => p.id))
        const toAdd = pendingPosts.filter(p => !existingIds.has(p.id))
        return toAdd.length > 0 ? [...old, ...toAdd] : old
      }
    )
    setPendingPosts([])
  }, [pendingPosts, threadId, queryClient])

  const handleAutoUpdateToggle = useCallback((checked: boolean) => {
    setAutoUpdate(checked)
    if (checked) {
      // Immediately merge any buffered posts
      loadPendingPosts()
    }
  }, [loadPendingPosts])

  const toggleBookmark = async () => {
    if (!thread || !user) return

    if (isBookmarked) {
      const { error } = await supabase.from('bookmarks').delete().eq('user_id', user.id).eq('thread_id', thread.id)
      if (error) {
        console.error('[FCV:Thread] Failed to remove bookmark:', error)
        return
      }
      setIsBookmarked(false)
    } else {
      const { error } = await supabase.from('bookmarks').insert({ user_id: user.id, thread_id: thread.id })
      if (error) {
        console.error('[FCV:Thread] Failed to add bookmark:', error)
        return
      }
      setIsBookmarked(true)
    }
    // Invalidate bookmarks cache
    queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks(user.id) })
  }

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!thread || !replyContent.trim() || !user) return

    setSubmitting(true)

    const { error, data: insertedPost } = await supabase
      .from('posts')
      .insert({
        thread_id: thread.id,
        author_id: user.id,
        content: replyContent.trim(),
        reply_to_id: replyingTo?.id || null,
      })
      .select('*, author:profiles(*)')
      .single()

    if (!error && insertedPost) {
      // Add to cache optimistically
      queryClient.setQueryData<PostWithAuthor[]>(
        queryKeys.posts(thread.id),
        (old = []) => {
          if (old.some(p => p.id === insertedPost.id)) return old
          const updated = [...old, insertedPost as PostWithAuthor]
          // Navigate to last page to see the new post
          const newTotalPages = Math.ceil(updated.length / POSTS_PER_PAGE)
          if (newTotalPages > currentPage) {
            setTimeout(() => goToPage(newTotalPages), 0)
          }
          return updated
        }
      )

      setReplyContent('')
      setReplyingTo(null)
      // Update thread's last_post_at
      const { error: updateError } = await supabase
        .from('threads')
        .update({ last_post_at: new Date().toISOString(), post_count: thread.post_count + 1 })
        .eq('id', thread.id)
      if (updateError) {
        console.error('[FCV:Thread] Failed to update thread after reply:', updateError)
      }

      // Invalidate caches so home page shows updated post count/last activity
      queryClient.invalidateQueries({ queryKey: queryKeys.threads(20) })
    } else if (error) {
      console.error('[FCV:Thread] Failed to post reply:', error)
    }

    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-3/4 rounded bg-slate-700" />
          <div className="h-32 rounded bg-slate-700" />
        </div>
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="mx-auto max-w-4xl text-center">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8">
          <svg className="mx-auto h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h1 className="mt-4 text-xl font-bold text-white">Error loading thread</h1>
          <p className="mt-2 text-slate-400">Something went wrong. Please try again.</p>
          <Button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: queryKeys.thread(threadId!) })
              queryClient.invalidateQueries({ queryKey: queryKeys.posts(threadId!) })
            }}
            className="mt-4 inline-block"
          >
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="text-2xl font-bold text-white">Thread not found</h1>
        <p className="mt-2 text-slate-400">The thread you're looking for doesn't exist.</p>
        <Link to="/" className="mt-4 inline-block text-indigo-400 hover:text-indigo-300">
          Go back home
        </Link>
      </div>
    )
  }

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
    <div className="mx-auto max-w-4xl">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
        <Link to="/" className="hover:text-white">Home</Link>
        <span>/</span>
        <Link to={`/c/${thread.category.slug}`} className="hover:text-white">{thread.category.name}</Link>
      </div>

      {/* Thread Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {thread.is_pinned && (
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                Pinned
              </span>
            )}
            {thread.is_locked && (
              <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
                Locked
              </span>
            )}
          </div>
          <button
            onClick={toggleBookmark}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              isBookmarked
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill={isBookmarked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span className="hidden sm:inline">
              {isBookmarked ? 'Bookmarked' : 'Bookmark'}
            </span>
          </button>
        </div>
        <div className="mt-2 flex items-start gap-3">
          <div className="relative shrink-0">
            <Avatar seed={thread.id} type="thread" avatarUrl={thread.image_url} className="h-12 w-12" />
            {user?.id === thread.author_id && (
              <button
                type="button"
                onClick={() => threadImageInputRef.current?.click()}
                disabled={avatarUploading}
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors"
                title="Change thread image"
              >
                {avatarUploading ? (
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                )}
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-white">{thread.title}</h1>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400 sm:gap-3">
          <span>Started by {thread.author.display_name || thread.author.username}</span>
          <span className="hidden sm:inline">·</span>
          <span>{formatDate(thread.created_at)}</span>
          <span>·</span>
          <span>{posts.length} {posts.length === 1 ? 'reply' : 'replies'}</span>
          {totalPages > 1 && (
            <>
              <span>·</span>
              <span>Page {currentPage} of {totalPages}</span>
            </>
          )}
        </div>
      </div>

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
                  <Avatar seed={post.author.id} type="user" avatarUrl={post.author.avatar_url} size={48} />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Mobile avatar */}
                    <div className="sm:hidden">
                      <Avatar seed={post.author.id} type="user" avatarUrl={post.author.avatar_url} size={24} />
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
                        onClick={() => setReplyingTo(post)}
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
        <div className="mt-6 flex items-center justify-center gap-1">
          {/* Previous */}
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
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
                onClick={() => goToPage(page)}
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
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
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

      {/* Reply Form */}
      {thread.is_locked ? (
        <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-center text-slate-400">
          This thread is locked. No new replies can be posted.
        </div>
      ) : !user ? (
        <Card className="mt-6 p-4 text-center">
          <p className="text-slate-400">
            <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">Sign in</Link> to reply to this thread
          </p>
        </Card>
      ) : (
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
                  onClick={() => setReplyingTo(null)}
                  className="text-slate-500 hover:text-white"
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
                rows={4}
                className="block w-full resize-none rounded-lg border border-slate-600 bg-slate-700 px-4 py-3 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <div className="mt-3 flex justify-end">
                <Button
                  type="submit"
                  disabled={submitting || !replyContent.trim()}
                >
                  {submitting ? 'Posting...' : 'Post Reply'}
                </Button>
              </div>
            </div>
          </Card>
        </form>
      )}

      {/* Hidden file input for thread image change */}
      <input
        ref={threadImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            const reader = new FileReader()
            reader.onload = () => setCropImageSrc(reader.result as string)
            reader.readAsDataURL(file)
          }
          e.target.value = ''
        }}
      />

      {cropImageSrc && (
        <ImageCropModal
          imageSrc={cropImageSrc}
          onCrop={async (blob) => {
            setCropImageSrc(null)
            setAvatarUploading(true)
            const imageUrl = await uploadAvatar(blob, `thread/${thread.id}/custom.png`)
            if (imageUrl) {
              await supabase.from('threads').update({ image_url: imageUrl }).eq('id', thread.id)
              // Update cache
              queryClient.setQueryData(queryKeys.thread(thread.id), { ...thread, image_url: imageUrl })
            }
            setAvatarUploading(false)
          }}
          onCancel={() => setCropImageSrc(null)}
        />
      )}
    </div>
  )
}
