import { useParams, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import Avatar from '../components/Avatar'
import type { Profile, ThreadWithAuthor, PostWithAuthor } from '../types'

type ActivityTab = 'threads' | 'posts'

export default function ProfilePage() {
  const { username } = useParams()
  const { user } = useAuth()
  const [profile, setProfile] = useState<(Profile & { threadCount?: number; postCount?: number }) | null>(null)
  const [threads, setThreads] = useState<ThreadWithAuthor[]>([])
  const [posts, setPosts] = useState<PostWithAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<ActivityTab>('threads')

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true)

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username!)
        .single()

      if (profileData) {
        setProfile(profileData)

        // Fetch user's threads
        const { data: threadsData } = await supabase
          .from('threads')
          .select(`
            *,
            author:profiles(*),
            category:categories(*)
          `)
          .eq('author_id', profileData.id)
          .order('created_at', { ascending: false })
          .limit(10)

        if (threadsData) setThreads(threadsData as ThreadWithAuthor[])

        // Fetch user's posts
        const { data: postsData } = await supabase
          .from('posts')
          .select(`
            *,
            author:profiles(*)
          `)
          .eq('author_id', profileData.id)
          .order('created_at', { ascending: false })
          .limit(20)

        if (postsData) setPosts(postsData as PostWithAuthor[])
      }

      setLoading(false)
    }

    fetchProfile()
  }, [username])

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const formatTimeAgo = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    const months = Math.floor(days / 30)
    return `${months}mo ago`
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="animate-pulse">
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
            <div className="flex items-start gap-4 sm:gap-6">
              <div className="h-16 w-16 rounded-full bg-slate-700 sm:h-24 sm:w-24" />
              <div className="flex-1">
                <div className="h-8 w-48 rounded bg-slate-700" />
                <div className="mt-2 h-4 w-32 rounded bg-slate-700" />
                <div className="mt-4 h-4 w-full rounded bg-slate-700" />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-4xl text-center">
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8">
          <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <h1 className="mt-4 text-2xl font-bold text-white">User not found</h1>
          <p className="mt-2 text-slate-400">The user @{username} doesn't exist.</p>
          <Link to="/" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500">
            Go back home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Profile Header */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 sm:p-6">
        <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left sm:gap-6">
          {/* Avatar */}
          <Avatar seed={profile.id} type="user" avatarUrl={profile.avatar_url} className="h-20 w-20 shrink-0 sm:h-24 sm:w-24" />

          {/* Info */}
          <div className="mt-4 flex-1 sm:mt-0">
            <h1 className="text-2xl font-bold text-white">
              {profile.display_name || profile.username}
            </h1>
            <p className="text-slate-400">@{profile.username}</p>

            {profile.bio && (
              <p className="mt-3 text-slate-300">{profile.bio}</p>
            )}

            {/* Stats */}
            <div className="mt-4 flex flex-wrap justify-center gap-6 sm:justify-start">
              <div>
                <span className="text-xl font-bold text-white">{profile.threadCount ?? threads.length}</span>
                <span className="ml-1 text-slate-400">threads</span>
              </div>
              <div>
                <span className="text-xl font-bold text-white">{profile.postCount ?? posts.length}</span>
                <span className="ml-1 text-slate-400">posts</span>
              </div>
              <div className="hidden sm:block">
                <span className="text-slate-400">Joined</span>
                <span className="ml-1 text-white">{formatDate(profile.created_at)}</span>
              </div>
            </div>

            {/* Mobile join date */}
            <p className="mt-3 text-sm text-slate-500 sm:hidden">
              Joined {formatDate(profile.created_at)}
            </p>

            {/* Message button - shown when viewing someone else's profile */}
            {user && profile.id !== user.id && (
              <Link
                to={`/dm/${profile.id}`}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Message
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Activity Tabs */}
      <div className="mt-6">
        <div className="flex gap-2 border-b border-slate-700 pb-4">
          <button
            onClick={() => setActiveTab('threads')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'threads'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            Threads ({threads.length})
          </button>
          <button
            onClick={() => setActiveTab('posts')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'posts'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            Posts ({posts.length})
          </button>
        </div>

        {/* Threads Tab */}
        {activeTab === 'threads' && (
          <div className="mt-4">
            {threads.length === 0 ? (
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
                <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="mt-4 text-slate-400">No threads yet.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 divide-y divide-slate-700/50">
                {threads.map((thread) => (
                  <Link
                    key={thread.id}
                    to={`/t/${thread.id}`}
                    className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-slate-700/30"
                  >
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
                      <h3 className="mt-1 font-medium text-white">{thread.title}</h3>
                      <p className="mt-1 text-sm text-slate-400">
                        {formatTimeAgo(thread.created_at)} · {thread.post_count} replies
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Posts Tab */}
        {activeTab === 'posts' && (
          <div className="mt-4">
            {posts.length === 0 ? (
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
                <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                <p className="mt-4 text-slate-400">No posts yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {posts.map((post) => (
                  <Link
                    key={post.id}
                    to={`/t/${post.thread_id}`}
                    className="block rounded-xl border border-slate-700 bg-slate-800/50 p-4 transition-colors hover:bg-slate-700/50"
                  >
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <span>{formatTimeAgo(post.created_at)}</span>
                      {post.reply_to_id && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                            Reply
                          </span>
                        </>
                      )}
                    </div>
                    <p className="mt-2 text-slate-300 line-clamp-3">{post.content}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
