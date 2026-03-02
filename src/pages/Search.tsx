import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import Avatar from '../components/Avatar'
import type { ThreadWithAuthor, PostWithAuthor } from '../types'

// Demo data for search results
const demoThreads: ThreadWithAuthor[] = [
  {
    id: '1',
    category_id: '1',
    author_id: '1',
    title: 'Welcome to the Forum! Introduce yourself here',
    slug: 'welcome',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    is_pinned: true,
    is_locked: false,
    post_count: 42,
    last_post_at: new Date().toISOString(),
    content: '',
    image_url: null,
    view_count: 0,
    author: { id: '1', username: 'admin', display_name: 'Admin', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
    category: { id: '1', name: 'General', slug: 'general', description: '', sort_order: 0, created_at: '' },
  },
  {
    id: '2',
    category_id: '2',
    author_id: '1',
    title: 'Roadmap: Chat and Voice features coming soon!',
    slug: 'roadmap-chat-voice',
    created_at: new Date(Date.now() - 172800000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
    is_pinned: true,
    is_locked: false,
    post_count: 15,
    last_post_at: new Date(Date.now() - 3600000).toISOString(),
    content: '',
    image_url: null,
    view_count: 0,
    author: { id: '1', username: 'admin', display_name: 'Admin', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
    category: { id: '2', name: 'Announcements', slug: 'announcements', description: '', sort_order: 1, created_at: '' },
  },
  {
    id: '3',
    category_id: '1',
    author_id: '2',
    title: 'What features would you like to see?',
    slug: 'feature-requests',
    created_at: new Date(Date.now() - 259200000).toISOString(),
    updated_at: new Date(Date.now() - 7200000).toISOString(),
    is_pinned: false,
    is_locked: false,
    post_count: 28,
    last_post_at: new Date(Date.now() - 7200000).toISOString(),
    content: '',
    image_url: null,
    view_count: 0,
    author: { id: '2', username: 'user1', display_name: 'Forum User', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
    category: { id: '1', name: 'General', slug: 'general', description: '', sort_order: 0, created_at: '' },
  },
]

const demoPosts: PostWithAuthor[] = [
  {
    id: '1',
    thread_id: '1',
    author_id: '1',
    content: "Welcome to our new forum! This is a hybrid platform combining the best of traditional forums with real-time chat and voice rooms.",
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 86400000).toISOString(),
    reply_to_id: null,
    author: { id: '1', username: 'admin', display_name: 'Admin', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '2',
    thread_id: '1',
    author_id: '2',
    content: "This looks amazing! I've been looking for something like this - forums + Discord features in one place.",
    created_at: new Date(Date.now() - 43200000).toISOString(),
    updated_at: new Date(Date.now() - 43200000).toISOString(),
    reply_to_id: null,
    author: { id: '2', username: 'sarah_dev', display_name: 'Sarah', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
]

type SearchFilter = 'all' | 'threads' | 'posts'

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''
  const filterParam = searchParams.get('filter') as SearchFilter || 'all'

  const [searchInput, setSearchInput] = useState(initialQuery)
  const [filter, setFilter] = useState<SearchFilter>(filterParam)
  const [threadResults, setThreadResults] = useState<ThreadWithAuthor[]>([])
  const [postResults, setPostResults] = useState<PostWithAuthor[]>([])

  const debouncedSearch = useDebounce(searchInput, 300)

  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setThreadResults([])
      setPostResults([])
      return
    }

    if (!isConfigured) {
      const lowerQuery = query.toLowerCase()
      setThreadResults(demoThreads.filter(t =>
        t.title.toLowerCase().includes(lowerQuery) ||
        t.author.username.toLowerCase().includes(lowerQuery)
      ))
      setPostResults(demoPosts.filter(p =>
        p.content.toLowerCase().includes(lowerQuery) ||
        p.author.username.toLowerCase().includes(lowerQuery)
      ))
      return
    }

    const pattern = `%${query}%`

    const [threadsRes, postsRes] = await Promise.all([
      supabase
        .from('threads')
        .select('*, author:profiles(*), category:categories(*)')
        .ilike('title', pattern)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('posts')
        .select('*, author:profiles(*)')
        .ilike('content', pattern)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    if (threadsRes.data) setThreadResults(threadsRes.data as ThreadWithAuthor[])
    if (postsRes.data) setPostResults(postsRes.data as PostWithAuthor[])
  }, [])

  useEffect(() => {
    performSearch(debouncedSearch)

    if (debouncedSearch.trim()) {
      setSearchParams({ q: debouncedSearch.trim(), filter }, { replace: true })
    } else if (searchParams.has('q')) {
      setSearchParams({}, { replace: true })
    }
  }, [debouncedSearch, filter, performSearch, setSearchParams, searchParams])

  const formatTimeAgo = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text
    try {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`(${escapedQuery})`, 'gi')
      const parts = text.split(regex)
      return parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-indigo-500/30 text-white rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )
    } catch {
      return text
    }
  }

  const totalResults = (filter === 'all' || filter === 'threads' ? threadResults.length : 0) +
                       (filter === 'all' || filter === 'posts' ? postResults.length : 0)

  const hasQuery = searchInput.trim().length > 0

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Search</h1>
        <p className="mt-1 text-slate-400">Results update as you type</p>
      </div>

      <div className="mb-6">
        <div className="relative">
          <svg className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Start typing to search..."
            className="w-full rounded-lg border border-slate-600 bg-slate-700 py-3 pl-12 pr-12 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            autoFocus
          />
          {hasQuery && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-600 hover:text-white"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {hasQuery && (
          <p className="mt-2 text-sm text-slate-400">
            {totalResults === 0 ? 'No results found' : (
              <>Found <span className="font-medium text-white">{totalResults}</span> result{totalResults !== 1 && 's'}</>
            )}
          </p>
        )}
      </div>

      <div className="mb-6 flex gap-2 border-b border-slate-700 pb-4">
        {(['all', 'threads', 'posts'] as SearchFilter[]).map((f) => {
          const count = f === 'all' ? totalResults : f === 'threads' ? threadResults.length : postResults.length
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {hasQuery && (
                <span className={`ml-2 text-xs ${filter === f ? 'opacity-75' : 'opacity-50'}`}>({count})</span>
              )}
            </button>
          )
        })}
      </div>

      {hasQuery ? (
        <div className="space-y-6">
          {(filter === 'all' || filter === 'threads') && threadResults.length > 0 && (
            <div>
              {filter === 'all' && (
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Threads ({threadResults.length})
                </h2>
              )}
              <div className="space-y-3">
                {threadResults.map((thread) => (
                  <Link
                    key={thread.id}
                    to={`/t/${thread.id}`}
                    className="block rounded-xl border border-slate-700 bg-slate-800/50 p-4 transition-colors hover:bg-slate-700/50"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar seed={thread.id} type="thread" avatarUrl={thread.image_url} className="h-10 w-10 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
                            {thread.category.name}
                          </span>
                          {thread.is_pinned && (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-400">
                              Pinned
                            </span>
                          )}
                        </div>
                        <h3 className="mt-1 font-medium text-white">
                          {highlightMatch(thread.title, searchInput)}
                        </h3>
                        <div className="mt-1 flex items-center gap-2 text-sm text-slate-400">
                          <span>{highlightMatch(thread.author.display_name || thread.author.username, searchInput)}</span>
                          <span>·</span>
                          <span>{formatTimeAgo(thread.created_at)}</span>
                          <span>·</span>
                          <span>{thread.post_count} replies</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {(filter === 'all' || filter === 'posts') && postResults.length > 0 && (
            <div>
              {filter === 'all' && (
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Posts ({postResults.length})
                </h2>
              )}
              <div className="space-y-3">
                {postResults.map((post) => (
                  <Link
                    key={post.id}
                    to={`/t/${post.thread_id}`}
                    className="block rounded-xl border border-slate-700 bg-slate-800/50 p-4 transition-colors hover:bg-slate-700/50"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar seed={post.author.id} type="user" avatarUrl={post.author.avatar_url} className="h-10 w-10 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium text-white">
                            {highlightMatch(post.author.display_name || post.author.username, searchInput)}
                          </span>
                          <span className="text-slate-500">·</span>
                          <span className="text-slate-400">{formatTimeAgo(post.created_at)}</span>
                        </div>
                        <p className="mt-2 text-slate-300 line-clamp-2">
                          {highlightMatch(post.content, searchInput)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {totalResults === 0 && (
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
              <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-white">No results for "{searchInput}"</h3>
              <p className="mt-2 text-slate-400">Try different keywords or check your spelling.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-white">Search the forum</h3>
          <p className="mt-2 text-slate-400">Start typing to see results instantly.</p>
          <div className="mt-4">
            <p className="mb-2 text-xs text-slate-500">Try searching for:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {['welcome', 'voice', 'features', 'admin'].map(term => (
                <button
                  key={term}
                  onClick={() => setSearchInput(term)}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600 transition-colors"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
