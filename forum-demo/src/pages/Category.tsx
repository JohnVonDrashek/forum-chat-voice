import { Link, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import Avatar from '../components/Avatar'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Skeleton from '../components/ui/Skeleton'
import { queryKeys, queryOptions } from '../lib/queries'
import { useDataProvider } from '../lib/data-provider'
import { formatRelativeTime } from '../lib/dateFormatters'

export default function Category() {
  const dp = useDataProvider()
  const { categorySlug } = useParams()
  const { user, getAccessToken } = useAuth()
  const queryClient = useQueryClient()

  // Use React Query for category data - cached!
  const { data: category, isLoading: categoryLoading, isError: categoryError } = useQuery({
    queryKey: queryKeys.category(categorySlug!),
    queryFn: () => dp.getCategory(categorySlug!),
    ...queryOptions.static,
    enabled: !!categorySlug,
  })

  // Use React Query for threads - cached!
  const { data: threads = [], isLoading: threadsLoading, isError: threadsError } = useQuery({
    queryKey: queryKeys.threadsByCategory(categorySlug!),
    queryFn: () => dp.getThreadsByCategory(categorySlug!),
    ...queryOptions.threads,
    enabled: !!categorySlug,
  })

  // Channel follow state
  const { data: followedCategories = [] } = useQuery({
    queryKey: ['channel-follows'],
    queryFn: async () => {
      const token = await getAccessToken()
      const res = await fetch('/api/channel-follows', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return []
      return res.json() as Promise<string[]>
    },
    enabled: !!user,
    staleTime: 30_000,
  })

  const isFollowing = category ? followedCategories.includes(category.id) : false

  const followMutation = useMutation({
    mutationFn: async ({ categoryId, follow }: { categoryId: string; follow: boolean }) => {
      const token = await getAccessToken()
      const res = await fetch('/api/channel-follows', {
        method: follow ? 'POST' : 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ category_id: categoryId }),
      })
      if (!res.ok) throw new Error('Failed to update follow')
    },
    onMutate: async ({ categoryId, follow }) => {
      await queryClient.cancelQueries({ queryKey: ['channel-follows'] })
      const prev = queryClient.getQueryData<string[]>(['channel-follows'])
      queryClient.setQueryData<string[]>(['channel-follows'], (old = []) =>
        follow ? [...old, categoryId] : old.filter(id => id !== categoryId)
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['channel-follows'], ctx.prev)
    },
  })

  const loading = categoryLoading || threadsLoading
  const hasError = categoryError || threadsError

  // Prefetch all visible threads once they load
  useEffect(() => {
    if (threads.length === 0) return

    threads.forEach((thread) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.thread(thread.id),
        queryFn: () => dp.getThread(thread.id),
        ...queryOptions.threads,
      })
      queryClient.prefetchQuery({
        queryKey: queryKeys.posts(thread.id),
        queryFn: () => dp.getPosts(thread.id),
        ...queryOptions.posts,
      })
    })
  }, [threads, queryClient])

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        {/* Header skeleton */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="mt-2 h-4 w-72" />
          </div>
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>

        {/* Thread list skeleton */}
        <Card>
          <div className="divide-y divide-slate-700/50">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-start gap-4 px-4 py-4">
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className={`h-5 ${i % 2 === 0 ? 'w-3/4' : 'w-2/3'}`} />
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <div className="hidden shrink-0 space-y-1 sm:block">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="mx-auto max-w-4xl text-center">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8">
          <h1 className="text-xl font-bold text-white">Error loading category</h1>
          <p className="mt-2 text-slate-400">Something went wrong. Check browser console for details.</p>
          <Button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: queryKeys.category(categorySlug!) })
              queryClient.invalidateQueries({ queryKey: queryKeys.threadsByCategory(categorySlug!) })
            }}
            className="mt-4 inline-block"
          >
            Retry
          </Button>
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => followMutation.mutate({ categoryId: category.id, follow: !isFollowing })}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isFollowing
                  ? 'bg-slate-700 text-white hover:bg-slate-600'
                  : 'text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
              title={isFollowing ? 'Unfollow this category' : 'Follow to get notified about new threads'}
            >
              <svg className="h-4 w-4" fill={isFollowing ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {isFollowing ? 'Following' : 'Follow'}
            </button>
            <Link
              to={`/c/${categorySlug}/new`}
              className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
            >
              New Thread
            </Link>
          </div>
        )}
      </div>

      {/* Threads */}
      <Card>
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
                    <span>{formatRelativeTime(thread.created_at)}</span>
                    <span>·</span>
                    <span>{thread.post_count} {thread.post_count === 1 ? 'reply' : 'replies'}</span>
                  </div>
                </div>

                <div className="hidden shrink-0 text-right text-sm sm:block">
                  <div className="text-slate-400">Last activity</div>
                  <div className="text-slate-300">{formatRelativeTime(thread.last_post_at || thread.updated_at)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
