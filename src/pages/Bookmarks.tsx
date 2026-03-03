import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import Avatar from '../components/Avatar'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { formatTimeAgo, formatDate } from '../lib/dateFormatters'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'

export default function Bookmarks() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Use React Query for bookmarks - cached globally!
  const { data: bookmarks = [], isLoading: loading, isError } = useQuery({
    queryKey: queryKeys.bookmarks(user?.id ?? ''),
    queryFn: () => fetchers.bookmarksWithMeta(user!.id),
    enabled: !!user,
    ...queryOptions.threads,
  })

  // Optimistic removal mutation
  const removeBookmarkMutation = useMutation({
    mutationFn: async (bookmarkId: string) => {
      await supabase.from('bookmarks').delete().eq('id', bookmarkId)
    },
    onMutate: async (bookmarkId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.bookmarks(user!.id) })

      // Snapshot the previous value
      const previousBookmarks = queryClient.getQueryData(queryKeys.bookmarks(user!.id))

      // Optimistically update to remove the bookmark
      queryClient.setQueryData(
        queryKeys.bookmarks(user!.id),
        (old: typeof bookmarks) => old?.filter(b => b.id !== bookmarkId) ?? []
      )

      return { previousBookmarks }
    },
    onError: (_err, _bookmarkId, context) => {
      // Rollback on error
      queryClient.setQueryData(queryKeys.bookmarks(user!.id), context?.previousBookmarks)
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks(user!.id) })
    },
  })

  const removeBookmark = (bookmarkId: string) => {
    removeBookmarkMutation.mutate(bookmarkId)
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-slate-700" />
          <div className="h-32 rounded bg-slate-700" />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h3 className="mt-4 font-medium text-white">Failed to load bookmarks</h3>
          <p className="mt-1 text-sm text-slate-400">Something went wrong. Please try again.</p>
          <Button
            onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks(user!.id) })}
            className="mt-4 inline-block text-sm"
          >
            Try again
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Bookmarks</h1>
        <p className="mt-1 text-slate-400">
          Threads you've saved for later
        </p>
      </div>

      {bookmarks.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-700">
            <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </div>
          <h3 className="font-medium text-white">No bookmarks yet</h3>
          <p className="mt-1 text-sm text-slate-400">
            Bookmark threads to save them for later reading
          </p>
          <Link
            to="/"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Browse threads
          </Link>
        </Card>
      ) : (
        <Card>
          <div className="border-b border-slate-700 px-4 py-3">
            <span className="text-sm text-slate-400">
              {bookmarks.length} {bookmarks.length === 1 ? 'bookmark' : 'bookmarks'}
            </span>
          </div>

          <div className="divide-y divide-slate-700/50">
            {bookmarks.map(bookmark => (
              <div
                key={bookmark.id}
                className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-slate-700/30"
              >
                <Avatar seed={bookmark.thread.id} type="thread" avatarUrl={bookmark.thread.image_url} className="h-10 w-10 shrink-0" />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
                      {bookmark.thread.category.name}
                    </span>
                  </div>
                  <Link
                    to={`/t/${bookmark.thread.id}`}
                    className="mt-1 block text-white hover:text-indigo-400"
                  >
                    <h3 className="font-medium line-clamp-2">{bookmark.thread.title}</h3>
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400 sm:gap-3 sm:text-sm">
                    <span>by {bookmark.thread.author.display_name || bookmark.thread.author.username}</span>
                    <span>·</span>
                    <span>{formatDate(bookmark.thread.created_at)}</span>
                    <span className="hidden sm:inline">·</span>
                    <span className="hidden sm:inline">Saved {formatTimeAgo(bookmark.created_at)}</span>
                  </div>
                </div>

                <button
                  onClick={() => removeBookmark(bookmark.id)}
                  className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-red-400"
                  title="Remove bookmark"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
