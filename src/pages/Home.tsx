import { Link } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Avatar from '../components/Avatar'
import Card from '../components/ui/Card'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'
import { formatTimeAgo } from '../lib/dateFormatters'

export default function Home() {
  const queryClient = useQueryClient()

  // Use React Query - instant on return visits!
  const { data: threads = [], isLoading, isError } = useQuery({
    queryKey: queryKeys.threads(20),
    queryFn: () => fetchers.threads(20),
    ...queryOptions.threads,
  })

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

  return (
    <div className="mx-auto max-w-4xl">
      {/* Hero */}
      <div className="mb-6 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white sm:mb-8 sm:p-8">
        <h1 className="text-2xl font-bold sm:text-3xl">Welcome to Forum</h1>
        <p className="mt-2 text-sm text-indigo-100 sm:text-base">
          A modern community platform combining forums, real-time chat, and voice rooms.
        </p>
      </div>

      {/* Recent Threads */}
      <Card>
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 className="text-lg font-semibold text-white">Recent Discussions</h2>
        </div>

        {isError ? (
          <div className="p-8 text-center">
            <p className="text-red-400">Failed to load threads</p>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.threads(20) })}
              className="mt-2 text-sm text-indigo-400 hover:text-indigo-300"
            >
              Try again
            </button>
          </div>
        ) : isLoading ? (
          <div className="divide-y divide-slate-700/50">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4 animate-pulse">
                <div className="h-9 w-9 shrink-0 rounded-full bg-slate-700 sm:h-10 sm:w-10" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-16 rounded bg-slate-700" />
                  </div>
                  <div className="h-5 w-3/4 rounded bg-slate-700" />
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded-full bg-slate-700" />
                    <div className="h-3 w-20 rounded bg-slate-700" />
                    <div className="h-3 w-12 rounded bg-slate-700" />
                  </div>
                </div>
                <div className="hidden shrink-0 space-y-1 sm:block">
                  <div className="h-3 w-16 rounded bg-slate-700" />
                  <div className="h-4 w-12 rounded bg-slate-700" />
                </div>
              </div>
            ))}
          </div>
        ) : threads.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No discussions yet. Be the first to start one!
          </div>
        ) : (
          <div className="divide-y divide-slate-700/50">
            {threads.map((thread) => (
              <Link
                key={thread.id}
                to={`/t/${thread.id}`}
                className="flex items-start gap-3 px-3 py-3 transition-colors hover:bg-slate-700/30 sm:gap-4 sm:px-4 sm:py-4"
              >
                {/* Thread Avatar */}
                <Avatar seed={thread.id} type="thread" avatarUrl={thread.image_url} className="h-9 w-9 shrink-0 sm:h-10 sm:w-10" />

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    {thread.is_pinned && (
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 sm:text-xs">
                        Pinned
                      </span>
                    )}
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 sm:text-xs">
                      {thread.category.name}
                    </span>
                  </div>
                  <h3 className="mt-1 text-sm font-medium text-white line-clamp-2 sm:text-base sm:line-clamp-1">
                    {thread.title}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400 sm:gap-3 sm:text-sm">
                    <span className="flex items-center gap-1">
                      <Avatar seed={thread.author_id} type="user" avatarUrl={thread.author.avatar_url} size={16} />
                      {thread.author.display_name || thread.author.username}
                    </span>
                    <span className="hidden sm:inline">·</span>
                    <span>{formatTimeAgo(thread.created_at)}</span>
                    <span>·</span>
                    <span>{thread.post_count} replies</span>
                  </div>
                </div>

                {/* Activity - hidden on mobile */}
                <div className="hidden shrink-0 text-right text-sm sm:block">
                  <div className="text-slate-400">Last activity</div>
                  <div className="text-slate-300">{formatTimeAgo(thread.last_post_at || thread.updated_at)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
