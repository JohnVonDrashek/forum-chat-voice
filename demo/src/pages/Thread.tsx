import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAuth } from '../lib/auth'
import { getDataProvider } from '../lib/data-provider'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'
import Button from '../components/ui/Button'
import Skeleton from '../components/ui/Skeleton'
import ThreadHeader from '../components/thread/ThreadHeader'
import PostList from '../components/thread/PostList'
import ReplyComposer from '../components/thread/ReplyComposer'
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

  const [replyingTo, setReplyingTo] = useState<PostWithAuthor | null>(null)
  const [pendingPosts, setPendingPosts] = useState<PostWithAuthor[]>([])
  const [autoUpdate, setAutoUpdate] = useState(false)

  const currentPage = parseInt(searchParams.get('page') || '1', 10)
  const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE)

  const goToPage = (page: number) => {
    if (page === 1) {
      searchParams.delete('page')
    } else {
      searchParams.set('page', page.toString())
    }
    setSearchParams(searchParams, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Bookmark status via React Query
  const { data: isBookmarked = false } = useQuery({
    queryKey: queryKeys.isBookmarked(user?.id ?? '', thread?.id ?? ''),
    queryFn: () => fetchers.isBookmarked(user!.id, thread!.id),
    enabled: !!thread && !!user,
  })

  // Bookmark toggle mutation with optimistic update
  const bookmarkMutation = useMutation({
    mutationFn: async () => {
      if (!thread || !user) throw new Error('Not authenticated')
      const dp = getDataProvider()
      if (isBookmarked) {
        await dp.removeBookmark(user.id, thread.id)
      } else {
        await dp.addBookmark(user.id, thread.id)
      }
    },
    onMutate: async () => {
      if (!thread || !user) return
      await queryClient.cancelQueries({ queryKey: queryKeys.isBookmarked(user.id, thread.id) })
      const previous = queryClient.getQueryData<boolean>(queryKeys.isBookmarked(user.id, thread.id))
      queryClient.setQueryData(queryKeys.isBookmarked(user.id, thread.id), !isBookmarked)
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (!thread || !user) return
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.isBookmarked(user.id, thread.id), context.previous)
      }
      toast.error('Failed to update bookmark')
      console.error('[FLD:Thread] Failed to toggle bookmark:', _error)
    },
    onSettled: () => {
      if (!thread || !user) return
      queryClient.invalidateQueries({ queryKey: queryKeys.isBookmarked(user.id, thread.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks(user.id) })
    },
  })

  const toggleBookmark = () => {
    if (!thread || !user) return
    bookmarkMutation.mutate()
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        {/* Breadcrumb skeleton */}
        <div className="mb-4 flex items-center gap-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-24" />
        </div>

        {/* Thread header skeleton */}
        <div className="mb-6">
          <div className="mt-2 flex items-start gap-3">
            <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-8 w-3/4" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>

        {/* Post skeletons */}
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
              <div className="flex gap-4">
                <Skeleton className="hidden h-12 w-12 shrink-0 rounded-full sm:block" />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            </div>
          ))}
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

  return (
    <div className="mx-auto max-w-4xl">
      <ThreadHeader
        thread={thread}
        postCount={posts.length}
        currentPage={currentPage}
        totalPages={totalPages}
        isBookmarked={isBookmarked}
        onToggleBookmark={toggleBookmark}
        currentUserId={user?.id}
      />

      <PostList
        thread={thread}
        posts={posts}
        currentPage={currentPage}
        totalPages={totalPages}
        pendingPosts={pendingPosts}
        autoUpdate={autoUpdate}
        onSetPendingPosts={setPendingPosts}
        onSetAutoUpdate={setAutoUpdate}
        onSetReplyingTo={setReplyingTo}
        onGoToPage={goToPage}
      />

      <ReplyComposer
        thread={thread}
        currentPage={currentPage}
        replyingTo={replyingTo}
        onSetReplyingTo={setReplyingTo}
        onGoToPage={goToPage}
      />
    </div>
  )
}
