import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase, isConfigured } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { ThreadWithAuthor, PostWithAuthor } from '../types'

const POSTS_PER_PAGE = 5

// Demo data
const demoThread: ThreadWithAuthor = {
  id: '1',
  category_id: '1',
  author_id: '1',
  title: 'Welcome to the Forum! Introduce yourself here',
  slug: 'welcome',
  created_at: new Date(Date.now() - 86400000).toISOString(),
  updated_at: new Date().toISOString(),
  is_pinned: true,
  is_locked: false,
  post_count: 12,
  last_post_at: new Date().toISOString(),
  content: '',
  view_count: 0,
  author: { id: '1', username: 'admin', display_name: 'Admin', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  category: { id: '1', name: 'General', slug: 'general', description: '', sort_order: 0, created_at: '' },
}

const demoPosts: PostWithAuthor[] = [
  {
    id: '1',
    thread_id: '1',
    author_id: '1',
    content: "Welcome to our new forum! This is a hybrid platform combining the best of traditional forums with real-time chat and voice rooms.\n\n**What's coming:**\n- Real-time chat channels\n- Voice rooms for hanging out\n- Full customization options\n- Federation with other instances\n\nFeel free to introduce yourself below!",
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 86400000).toISOString(),
    reply_to_id: null,
    author: { id: '1', username: 'admin', display_name: 'Admin', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '2',
    thread_id: '1',
    author_id: '2',
    content: "This looks amazing! I've been looking for something like this - forums + Discord features in one place. Can't wait to see how this develops!",
    created_at: new Date(Date.now() - 82800000).toISOString(),
    updated_at: new Date(Date.now() - 82800000).toISOString(),
    reply_to_id: null,
    author: { id: '2', username: 'sarah_dev', display_name: 'Sarah', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '3',
    thread_id: '1',
    author_id: '3',
    content: "Hey everyone! Long-time forum enthusiast here. Really excited about the voice rooms feature - that's something I've wanted in a forum platform for ages.\n\nQuick question: will there be moderation tools for voice rooms?",
    created_at: new Date(Date.now() - 79200000).toISOString(),
    updated_at: new Date(Date.now() - 79200000).toISOString(),
    reply_to_id: null,
    author: { id: '3', username: 'mike_m', display_name: 'Mike', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '4',
    thread_id: '1',
    author_id: '1',
    content: "Great question! Yes, voice rooms will have full moderation support:\n\n- Mute/unmute participants\n- Kick from room\n- Temporary bans\n- Priority speaker mode for announcements\n\nWe're also planning stage-style rooms for larger events.",
    created_at: new Date(Date.now() - 75600000).toISOString(),
    updated_at: new Date(Date.now() - 75600000).toISOString(),
    reply_to_id: '3',
    author: { id: '1', username: 'admin', display_name: 'Admin', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '5',
    thread_id: '1',
    author_id: '4',
    content: "Just signed up! The UI looks really clean. Is there a dark mode? (asking the important questions here)",
    created_at: new Date(Date.now() - 72000000).toISOString(),
    updated_at: new Date(Date.now() - 72000000).toISOString(),
    reply_to_id: null,
    author: { id: '4', username: 'alex_tech', display_name: 'Alex', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '6',
    thread_id: '1',
    author_id: '2',
    content: "You're already looking at it! The whole thing is dark mode by default. Love it.",
    created_at: new Date(Date.now() - 68400000).toISOString(),
    updated_at: new Date(Date.now() - 68400000).toISOString(),
    reply_to_id: '5',
    author: { id: '2', username: 'sarah_dev', display_name: 'Sarah', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '7',
    thread_id: '1',
    author_id: '5',
    content: "Hello from Australia! Just discovered this platform through a friend. The combination of forums and real-time features is exactly what our gaming community needs.",
    created_at: new Date(Date.now() - 64800000).toISOString(),
    updated_at: new Date(Date.now() - 64800000).toISOString(),
    reply_to_id: null,
    author: { id: '5', username: 'gamer_oz', display_name: 'OzGamer', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '8',
    thread_id: '1',
    author_id: '6',
    content: "Software developer here. Would love to see an API for building integrations. Any plans for that?",
    created_at: new Date(Date.now() - 57600000).toISOString(),
    updated_at: new Date(Date.now() - 57600000).toISOString(),
    reply_to_id: null,
    author: { id: '6', username: 'dev_emma', display_name: 'Emma', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '9',
    thread_id: '1',
    author_id: '1',
    content: "Absolutely! We're planning a full REST API and webhook support. Stay tuned for the developer documentation.",
    created_at: new Date(Date.now() - 50400000).toISOString(),
    updated_at: new Date(Date.now() - 50400000).toISOString(),
    reply_to_id: '8',
    author: { id: '1', username: 'admin', display_name: 'Admin', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '10',
    thread_id: '1',
    author_id: '7',
    content: "This is giving me old-school forum vibes but with modern features. Nostalgic and fresh at the same time!",
    created_at: new Date(Date.now() - 43200000).toISOString(),
    updated_at: new Date(Date.now() - 43200000).toISOString(),
    reply_to_id: null,
    author: { id: '7', username: 'retro_fan', display_name: 'RetroFan', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '11',
    thread_id: '1',
    author_id: '3',
    content: "Thanks for the info about moderation tools! That's exactly what we need. Looking forward to trying out the voice rooms once they're fully ready.",
    created_at: new Date(Date.now() - 28800000).toISOString(),
    updated_at: new Date(Date.now() - 28800000).toISOString(),
    reply_to_id: '4',
    author: { id: '3', username: 'mike_m', display_name: 'Mike', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
  {
    id: '12',
    thread_id: '1',
    author_id: '4',
    content: "Just tried the chat feature - super smooth! The real-time updates are instant. Great work on the performance.",
    created_at: new Date(Date.now() - 14400000).toISOString(),
    updated_at: new Date(Date.now() - 14400000).toISOString(),
    reply_to_id: null,
    author: { id: '4', username: 'alex_tech', display_name: 'Alex', avatar_url: null, bio: null, website: null, is_admin: false, created_at: '', updated_at: '2025-01-01' },
  },
]

export default function Thread() {
  const { threadId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const [thread, setThread] = useState<ThreadWithAuthor | null>(null)
  const [allPosts, setAllPosts] = useState<PostWithAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [replyContent, setReplyContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyingTo, setReplyingTo] = useState<PostWithAuthor | null>(null)
  const [isBookmarked, setIsBookmarked] = useState(false)

  const currentPage = parseInt(searchParams.get('page') || '1', 10)
  const totalPages = Math.ceil(allPosts.length / POSTS_PER_PAGE)
  const paginatedPosts = allPosts.slice(
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

  useEffect(() => {
    if (!isConfigured) {
      setThread(demoThread)
      setAllPosts(demoPosts)
      setLoading(false)
      return
    }

    const fetchData = async () => {
      setLoading(true)

      // Fetch thread
      const { data: threadData } = await supabase
        .from('threads')
        .select(`
          *,
          author:profiles(*),
          category:categories(*)
        `)
        .eq('id', threadId!)
        .single()

      if (threadData) {
        setThread(threadData as ThreadWithAuthor)

        // Fetch posts
        const { data: postsData } = await supabase
          .from('posts')
          .select(`
            *,
            author:profiles(*)
          `)
          .eq('thread_id', threadId!)
          .order('created_at')

        if (postsData) setAllPosts(postsData as PostWithAuthor[])
      }

      setLoading(false)
    }

    fetchData()

    // Set up real-time subscription
    if (isConfigured) {
      const subscription = supabase
        .channel(`thread:${threadId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'posts', filter: `thread_id=eq.${threadId}` },
          async (payload) => {
            // Fetch the new post with author
            const { data } = await supabase
              .from('posts')
              .select('*, author:profiles(*)')
              .eq('id', payload.new.id)
              .single()
            if (data) {
              setAllPosts((prev) => [...prev, data as PostWithAuthor])
            }
          }
        )
        .subscribe()

      return () => {
        subscription.unsubscribe()
      }
    }
  }, [threadId])

  // Check bookmark status
  useEffect(() => {
    if (!thread) return

    if (isConfigured && user) {
      supabase
        .from('bookmarks')
        .select('id')
        .eq('user_id', user.id)
        .eq('thread_id', thread.id)
        .maybeSingle()
        .then(({ data }) => setIsBookmarked(!!data))
    } else if (!isConfigured) {
      const bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]')
      setIsBookmarked(bookmarks.some((b: { id: string }) => b.id === thread.id))
    }
  }, [thread?.id, user])

  const toggleBookmark = async () => {
    if (!thread) return

    if (isConfigured) {
      if (!user) return
      if (isBookmarked) {
        await supabase.from('bookmarks').delete().eq('user_id', user.id).eq('thread_id', thread.id)
        setIsBookmarked(false)
      } else {
        await supabase.from('bookmarks').insert({ user_id: user.id, thread_id: thread.id })
        setIsBookmarked(true)
      }
    } else {
      const bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]')
      if (isBookmarked) {
        const updated = bookmarks.filter((b: { id: string }) => b.id !== thread.id)
        localStorage.setItem('bookmarks', JSON.stringify(updated))
        setIsBookmarked(false)
      } else {
        bookmarks.push({
          id: thread.id,
          title: thread.title,
          category: thread.category.name,
          categorySlug: thread.category.slug,
          author: thread.author.display_name || thread.author.username,
          createdAt: thread.created_at,
          bookmarkedAt: new Date().toISOString(),
        })
        localStorage.setItem('bookmarks', JSON.stringify(bookmarks))
        setIsBookmarked(true)
      }
    }
  }

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!thread || !replyContent.trim()) return

    setSubmitting(true)

    // Demo mode - add post locally
    if (!isConfigured) {
      const newPost: PostWithAuthor = {
        id: Date.now().toString(),
        thread_id: thread.id,
        author_id: user?.id || 'demo',
        content: replyContent.trim(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        reply_to_id: replyingTo?.id || null,
        author: {
          id: user?.id || 'demo',
          username: user?.user_metadata?.username || 'you',
          display_name: user?.user_metadata?.username || 'You',
          avatar_url: null,
          bio: null,
          website: null,
          is_admin: false,
          created_at: '',
          updated_at: '2025-01-01',
        },
      }
      setAllPosts(prev => [...prev, newPost])
      setReplyContent('')
      setReplyingTo(null)
      setSubmitting(false)
      // Go to last page to see the new post
      const newTotalPages = Math.ceil((allPosts.length + 1) / POSTS_PER_PAGE)
      if (newTotalPages > currentPage) {
        goToPage(newTotalPages)
      }
      return
    }

    // Supabase mode
    if (!user) return

    const { error } = await supabase.from('posts').insert({
      thread_id: thread.id,
      author_id: user.id,
      content: replyContent.trim(),
      reply_to_id: replyingTo?.id || null,
    })

    if (!error) {
      setReplyContent('')
      setReplyingTo(null)
      // Update thread's last_post_at
      await supabase
        .from('threads')
        .update({ last_post_at: new Date().toISOString(), post_count: thread.post_count + 1 })
        .eq('id', thread.id)
    }

    setSubmitting(false)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
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
        <h1 className="mt-2 text-2xl font-bold text-white">{thread.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400 sm:gap-3">
          <span>Started by {thread.author.display_name || thread.author.username}</span>
          <span className="hidden sm:inline">·</span>
          <span>{formatDate(thread.created_at)}</span>
          <span>·</span>
          <span>{allPosts.length} {allPosts.length === 1 ? 'reply' : 'replies'}</span>
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
          const replyToPost = post.reply_to_id ? allPosts.find(p => p.id === post.reply_to_id) : null
          const isOP = post.author_id === thread.author_id

          return (
            <div key={post.id} className="rounded-xl border border-slate-700 bg-slate-800/50">
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
                  <div className="h-12 w-12 rounded-full bg-indigo-500 flex items-center justify-center text-lg font-medium text-white">
                    {(post.author.display_name?.[0] || post.author.username[0]).toUpperCase()}
                  </div>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Mobile avatar */}
                    <div className="h-6 w-6 rounded-full bg-indigo-500 flex items-center justify-center text-xs font-medium text-white sm:hidden">
                      {(post.author.display_name?.[0] || post.author.username[0]).toUpperCase()}
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
            </div>
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

      {/* Reply Form */}
      {thread.is_locked ? (
        <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-center text-slate-400">
          This thread is locked. No new replies can be posted.
        </div>
      ) : isConfigured && !user ? (
        <div className="mt-6 rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-center">
          <p className="text-slate-400">
            <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">Sign in</Link> to reply to this thread
          </p>
        </div>
      ) : (
        <form onSubmit={handleReply} className="mt-6">
          <div className="rounded-xl border border-slate-700 bg-slate-800/50">
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
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  {!isConfigured && "Demo mode - replies are stored locally"}
                </p>
                <button
                  type="submit"
                  disabled={submitting || !replyContent.trim()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {submitting ? 'Posting...' : 'Post Reply'}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
