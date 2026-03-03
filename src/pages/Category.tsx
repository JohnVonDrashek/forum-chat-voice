import { Link, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import Avatar from '../components/Avatar'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'
import { formatTimeAgo } from '../lib/dateFormatters'

export default function Category() {
  const { categorySlug } = useParams()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Use React Query for category data - cached!
  const { data: category, isLoading: categoryLoading, isError: categoryError } = useQuery({
    queryKey: queryKeys.category(categorySlug!),
    queryFn: () => fetchers.category(categorySlug!),
    ...queryOptions.static,
    enabled: !!categorySlug,
  })

  // Use React Query for threads - cached!
  const { data: threads = [], isLoading: threadsLoading, isError: threadsError } = useQuery({
    queryKey: queryKeys.threadsByCategory(categorySlug!),
    queryFn: () => fetchers.threadsByCategory(categorySlug!),
    ...queryOptions.threads,
    enabled: !!categorySlug,
  })

  const loading = categoryLoading || threadsLoading
  const hasError = categoryError || threadsError

  // Prefetch all visible threads once they load
  useEffect(() => {
    if (threads.length === 0) return

    threads.forEach((thread) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.thread(thread.id),
        queryFn: () => fetchers.thread(thread.id),
        ...queryOptions.threads,
      })
      queryClient.prefetchQuery({
        queryKey: queryKeys.posts(thread.id),
        queryFn: () => fetchers.posts(thread.id),
        ...queryOptions.posts,
      })
    })
  }, [threads, queryClient])

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="animate-pulse">
          <div className="h-8 w-48 rounded bg-slate-700" />
          <div className="mt-2 h-4 w-96 rounded bg-slate-700" />
        </div>
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="mx-auto max-w-4xl text-center">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8">
          <h1 className="text-xl font-bold text-white">Error loading category</h1>
          <p className="mt-2 text-slate-400">Something went wrong. Check browser console for details.</p>
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: queryKeys.category(categorySlug!) })
              queryClient.invalidateQueries({ queryKey: queryKeys.threadsByCategory(categorySlug!) })
            }}
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!category) {
    return (
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="text-2xl font-bold text-white">Category not found</h1>
        <p className="mt-2 text-slate-400">The category you're looking for doesn't exist.</p>
        <Link to="/" className="mt-4 inline-block text-indigo-400 hover:text-indigo-300">
          Go back home
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{category.name}</h1>
          {category.description && (
            <p className="mt-1 text-slate-400">{category.description}</p>
          )}
        </div>
        {user && (
          <Link
            to={`/c/${categorySlug}/new`}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
          >
            New Thread
          </Link>
        )}
      </div>

      {/* Threads */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50">
        {threads.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-slate-400">No threads yet.</p>
            {user ? (
              <Link
                to={`/c/${categorySlug}/new`}
                className="mt-2 inline-block text-indigo-400 hover:text-indigo-300"
              >
                Start a discussion
              </Link>
            ) : (
              <Link
                to="/login"
                className="mt-2 inline-block text-indigo-400 hover:text-indigo-300"
              >
                Sign in to start a discussion
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-700/50">
            {threads.map((thread) => (
              <Link
                key={thread.id}
                to={`/t/${thread.id}`}
                className="flex items-start gap-4 px-4 py-4 transition-colors hover:bg-slate-700/30"
              >
                <Avatar seed={thread.id} type="thread" avatarUrl={thread.image_url} className="h-10 w-10 shrink-0" />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {thread.is_pinned && (
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-400">
                        Pinned
                      </span>
                    )}
                    {thread.is_locked && (
                      <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs font-medium text-red-400">
                        Locked
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 font-medium text-white line-clamp-1">
                    {thread.title}
                  </h3>
                  <div className="mt-1 flex items-center gap-3 text-sm text-slate-400">
                    <span>{thread.author.display_name || thread.author.username}</span>
                    <span>·</span>
                    <span>{formatTimeAgo(thread.created_at)}</span>
                    <span>·</span>
                    <span>{thread.post_count} replies</span>
                  </div>
                </div>

                <div className="hidden shrink-0 text-right text-sm sm:block">
                  <div className="text-slate-400">Last activity</div>
                  <div className="text-slate-300">{formatTimeAgo(thread.last_post_at || thread.updated_at)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
