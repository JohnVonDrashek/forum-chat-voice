import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
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
    author: { id: '1', username: 'admin', display_name: 'Admin', avatar_url: null, bio: null, created_at: '' },
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
    author: { id: '1', username: 'admin', display_name: 'Admin', avatar_url: null, bio: null, created_at: '' },
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
    author: { id: '2', username: 'user1', display_name: 'Forum User', avatar_url: null, bio: null, created_at: '' },
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
    author: { id: '1', username: 'admin', display_name: 'Admin', avatar_url: null, bio: null, created_at: '' },
  },
  {
    id: '2',
    thread_id: '1',
    author_id: '2',
    content: "This looks amazing! I've been looking for something like this - forums + Discord features in one place.",
    created_at: new Date(Date.now() - 43200000).toISOString(),
    updated_at: new Date(Date.now() - 43200000).toISOString(),
    reply_to_id: null,
    author: { id: '2', username: 'sarah_dev', display_name: 'Sarah', avatar_url: null, bio: null, created_at: '' },
  },
  {
    id: '3',
    thread_id: '2',
    author_id: '3',
    content: "Really excited about the voice rooms feature - that's something I've wanted in a forum platform for ages.",
    created_at: new Date(Date.now() - 28800000).toISOString(),
    updated_at: new Date(Date.now() - 28800000).toISOString(),
    reply_to_id: null,
    author: { id: '3', username: 'mike_m', display_name: 'Mike', avatar_url: null, bio: null, created_at: '' },
  },
]

type SearchFilter = 'all' | 'threads' | 'posts'

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') || ''
  const filterParam = searchParams.get('filter') as SearchFilter || 'all'

  const [searchInput, setSearchInput] = useState(query)
  const [filter, setFilter] = useState<SearchFilter>(filterParam)
  const [loading, setLoading] = useState(false)
  const [threadResults, setThreadResults] = useState<ThreadWithAuthor[]>([])
  const [postResults, setPostResults] = useState<PostWithAuthor[]>([])

  // Search function
  useEffect(() => {
    if (!query) {
      setThreadResults([])
      setPostResults([])
      return
    }

    setLoading(true)

    // Simulate search delay
    const timeout = setTimeout(() => {
      const lowerQuery = query.toLowerCase()

      // Filter threads
      const matchingThreads = demoThreads.filter(thread =>
        thread.title.toLowerCase().includes(lowerQuery) ||
        thread.author.username.toLowerCase().includes(lowerQuery) ||
        thread.author.display_name?.toLowerCase().includes(lowerQuery)
      )

      // Filter posts
      const matchingPosts = demoPosts.filter(post =>
        post.content.toLowerCase().includes(lowerQuery) ||
        post.author.username.toLowerCase().includes(lowerQuery) ||
        post.author.display_name?.toLowerCase().includes(lowerQuery)
      )

      setThreadResults(matchingThreads)
      setPostResults(matchingPosts)
      setLoading(false)
    }, 300)

    return () => clearTimeout(timeout)
  }, [query])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchInput.trim()) {
      setSearchParams({ q: searchInput.trim(), filter })
    }
  }

  const handleFilterChange = (newFilter: SearchFilter) => {
    setFilter(newFilter)
    if (query) {
      setSearchParams({ q: query, filter: newFilter })
    }
  }

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
    if (!query) return text
    const regex = new RegExp(`(${query})`, 'gi')
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
  }

  const totalResults = (filter === 'all' || filter === 'threads' ? threadResults.length : 0) +
                       (filter === 'all' || filter === 'posts' ? postResults.length : 0)

  return (
    <div className="mx-auto max-w-4xl">
      {/* Search Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Search</h1>
        <p className="mt-1 text-slate-400">Find threads and posts across the forum</p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search threads and posts..."
              className="w-full rounded-lg border border-slate-600 bg-slate-700 py-3 pl-12 pr-4 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-500"
          >
            Search
          </button>
        </div>
      </form>

      {/* Filter Tabs */}
      <div className="mb-6 flex gap-2 border-b border-slate-700 pb-4">
        {(['all', 'threads', 'posts'] as SearchFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => handleFilterChange(f)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {query && (
              <span className="ml-2 text-xs opacity-75">
                ({f === 'all' ? totalResults : f === 'threads' ? threadResults.length : postResults.length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-xl border border-slate-700 bg-slate-800/50 p-4">
              <div className="h-5 w-3/4 rounded bg-slate-700" />
              <div className="mt-2 h-4 w-1/2 rounded bg-slate-700" />
            </div>
          ))}
        </div>
      ) : query ? (
        <div className="space-y-6">
          {/* Thread Results */}
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
                      <div className="h-10 w-10 shrink-0 rounded-full bg-indigo-500 flex items-center justify-center text-sm font-medium text-white">
                        {(thread.author.display_name?.[0] || thread.author.username[0]).toUpperCase()}
                      </div>
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
                          {highlightMatch(thread.title, query)}
                        </h3>
                        <div className="mt-1 flex items-center gap-2 text-sm text-slate-400">
                          <span>{thread.author.display_name || thread.author.username}</span>
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

          {/* Post Results */}
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
                      <div className="h-10 w-10 shrink-0 rounded-full bg-indigo-500 flex items-center justify-center text-sm font-medium text-white">
                        {(post.author.display_name?.[0] || post.author.username[0]).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium text-white">
                            {post.author.display_name || post.author.username}
                          </span>
                          <span className="text-slate-500">·</span>
                          <span className="text-slate-400">{formatTimeAgo(post.created_at)}</span>
                        </div>
                        <p className="mt-2 text-slate-300 line-clamp-2">
                          {highlightMatch(post.content, query)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* No Results */}
          {totalResults === 0 && (
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
              <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-white">No results found</h3>
              <p className="mt-2 text-slate-400">
                Try searching for different keywords or check your spelling.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-white">Search the forum</h3>
          <p className="mt-2 text-slate-400">
            Enter a search term above to find threads and posts.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => { setSearchInput('welcome'); setSearchParams({ q: 'welcome', filter: 'all' }) }}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600"
            >
              welcome
            </button>
            <button
              onClick={() => { setSearchInput('voice'); setSearchParams({ q: 'voice', filter: 'all' }) }}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600"
            >
              voice
            </button>
            <button
              onClick={() => { setSearchInput('features'); setSearchParams({ q: 'features', filter: 'all' }) }}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600"
            >
              features
            </button>
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-slate-500">
        Demo mode - searching local data only
      </p>
    </div>
  )
}
