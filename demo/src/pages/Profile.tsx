import { useParams, Link } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import Avatar from '../components/Avatar'
import Card from '../components/ui/Card'
import Skeleton from '../components/ui/Skeleton'
import { formatTimeAgo } from '../lib/dateFormatters'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'

type ActivityTab = 'threads' | 'posts'

export default function ProfilePage() {
  const { username } = useParams()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<ActivityTab>('threads')

  // Use React Query for profile - cached globally!
  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: queryKeys.profileByUsername(username!),
    queryFn: () => fetchers.profileByUsername(username!),
    enabled: !!username,
    ...queryOptions.profiles,
  })

  // Fetch threads and posts once we have the profile
  const { data: threads = [] } = useQuery({
    queryKey: queryKeys.userThreads(profile?.id ?? ''),
    queryFn: () => fetchers.userThreads(profile!.id),
    enabled: !!profile?.id,
    ...queryOptions.threads,
  })

  const { data: posts = [] } = useQuery({
    queryKey: queryKeys.userPosts(profile?.id ?? ''),
    queryFn: () => fetchers.userPosts(profile!.id),
    enabled: !!profile?.id,
    ...queryOptions.threads,
  })

  const loading = profileLoading

  const formatJoinDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        {/* Profile header skeleton */}
        <Card className="p-4 sm:p-6">
          <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left sm:gap-6">
            <Skeleton className="h-20 w-20 shrink-0 rounded-full sm:h-24 sm:w-24" />
            <div className="mt-4 flex-1 sm:mt-0 w-full">
              <Skeleton className="mx-auto h-8 w-48 sm:mx-0" />
              <Skeleton className="mx-auto mt-2 h-4 w-32 sm:mx-0" />
              <Skeleton className="mx-auto mt-3 h-4 w-full max-w-md sm:mx-0" />
              <div className="mt-4 flex flex-wrap justify-center gap-6 sm:justify-start">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-16" />
                <Skeleton className="hidden h-6 w-32 sm:block" />
              </div>
            </div>
          </div>
        </Card>

        {/* Activity tabs skeleton */}
        <div className="mt-6">
          <div className="flex gap-2 border-b border-slate-700 pb-4">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
          <div className="mt-4 space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (profileError) {
    return (
      <div className="mx-auto max-w-4xl text-center">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8">
          <h1 className="text-xl font-bold text-white">Error loading profile</h1>
          <p className="mt-2 text-slate-400">Something went wrong. Check browser console for details.</p>
          <Link to="/" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500">
            Go back home
          </Link>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-4xl text-center">
        <Card className="p-8">
          <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <h1 className="mt-4 text-2xl font-bold text-white">User not found</h1>
          <p className="mt-2 text-slate-400">The user @{username} doesn't exist.</p>
          <Link to="/" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500">
            Go back home
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Profile Header */}
      <Card className="p-4 sm:p-6">
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
                <span className="text-xl font-bold text-white">{threads.length}</span>
                <span className="ml-1 text-slate-400">threads</span>
              </div>
              <div>
                <span className="text-xl font-bold text-white">{posts.length}</span>
                <span className="ml-1 text-slate-400">posts</span>
              </div>
              <div className="hidden sm:block">
                <span className="text-slate-400">Joined</span>
                <span className="ml-1 text-white">{formatJoinDate(profile.created_at)}</span>
              </div>
            </div>

            {/* Mobile join date */}
            <p className="mt-3 text-sm text-slate-500 sm:hidden">
              Joined {formatJoinDate(profile.created_at)}
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
      </Card>

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
              <Card className="p-8 text-center">
                <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="mt-4 text-slate-400">No threads yet.</p>
              </Card>
            ) : (
              <Card className="divide-y divide-slate-700/50">
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
              </Card>
            )}
          </div>
        )}

        {/* Posts Tab */}
        {activeTab === 'posts' && (
          <div className="mt-4">
            {posts.length === 0 ? (
              <Card className="p-8 text-center">
                <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                <p className="mt-4 text-slate-400">No posts yet.</p>
              </Card>
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
