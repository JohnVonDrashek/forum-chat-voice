import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase, isConfigured } from '../lib/supabase'
import Avatar from '../components/Avatar'
import type { ThreadWithAuthor } from '../types'

interface BookmarkWithThread {
  id: string
  thread: ThreadWithAuthor
  created_at: string
}

export default function Bookmarks() {
  const { user, loading: authLoading } = useAuth()
  const [bookmarks, setBookmarks] = useState<BookmarkWithThread[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isConfigured) {
      // Legacy localStorage fallback for demo mode
      const stored = localStorage.getItem('bookmarks')
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          setBookmarks(parsed.map((b: { id: string; title: string; category: string; categorySlug: string; author: string; createdAt: string; bookmarkedAt: string }) => ({
            id: b.id,
            thread: {
              id: b.id,
              title: b.title,
              slug: '',
              category_id: '',
              author_id: '',
              created_at: b.createdAt,
              updated_at: b.createdAt,
              is_pinned: false,
              is_locked: false,
              post_count: 0,
              last_post_at: null,
              content: null,
              view_count: 0,
              author: { id: '', username: b.author, display_name: b.author, avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '' },
              category: { id: '', name: b.category, slug: b.categorySlug, description: null, sort_order: 0, created_at: '' },
            },
            created_at: b.bookmarkedAt,
          })))
        } catch { /* ignore parse errors */ }
      }
      setLoading(false)
      return
    }

    if (!user) {
      setLoading(false)
      return
    }

    const fetchBookmarks = async () => {
      const { data } = await supabase
        .from('bookmarks')
        .select('*, thread:threads(*, author:profiles(*), category:categories(*))')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (data) {
        setBookmarks(data.map(b => ({
          id: b.id,
          thread: b.thread as unknown as ThreadWithAuthor,
          created_at: b.created_at,
        })))
      }
      setLoading(false)
    }

    fetchBookmarks()
  }, [user])

  const removeBookmark = async (bookmarkId: string, threadId: string) => {
    if (isConfigured && user) {
      await supabase.from('bookmarks').delete().eq('id', bookmarkId)
    } else {
      const stored = JSON.parse(localStorage.getItem('bookmarks') || '[]')
      localStorage.setItem('bookmarks', JSON.stringify(stored.filter((b: { id: string }) => b.id !== threadId)))
    }
    setBookmarks(prev => prev.filter(b => b.id !== bookmarkId))
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatTimeAgo = (date: string) => {
    const now = new Date()
    const then = new Date(date)
    const diff = now.getTime() - then.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  // Auth guard for Supabase mode
  if (isConfigured && !authLoading && !user) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          <h3 className="mt-4 font-medium text-white">Sign in to view bookmarks</h3>
          <p className="mt-1 text-sm text-slate-400">You need to be logged in to save and view bookmarks.</p>
          <Link to="/login" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Sign In
          </Link>
        </div>
      </div>
    )
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

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Bookmarks</h1>
        <p className="mt-1 text-slate-400">
          Threads you've saved for later
        </p>
      </div>

      {bookmarks.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
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
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50">
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
                  onClick={() => removeBookmark(bookmark.id, bookmark.thread.id)}
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
        </div>
      )}
    </div>
  )
}
