import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import Avatar from '../components/Avatar'
import Card from '../components/ui/Card'
import { formatTimeAgo } from '../lib/dateFormatters'
import type { Profile } from '../types'

type Tab = 'overview' | 'users' | 'content' | 'reports'

interface Stats {
  totalUsers: number
  totalThreads: number
  totalPosts: number
}

export default function Admin() {
  const { user, profile } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, totalThreads: 0, totalPosts: 0 })
  const [users, setUsers] = useState<Profile[]>([])
  const [userSearch, setUserSearch] = useState('')

  useEffect(() => {
    if (!user) return

    const fetchStats = async () => {
      const [usersRes, threadsRes, postsRes] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('threads').select('*', { count: 'exact', head: true }),
        supabase.from('posts').select('*', { count: 'exact', head: true }),
      ])

      setStats({
        totalUsers: usersRes.count ?? 0,
        totalThreads: threadsRes.count ?? 0,
        totalPosts: postsRes.count ?? 0,
      })
    }

    const fetchUsers = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)
      if (data) setUsers(data)
    }

    fetchStats()
    fetchUsers()
  }, [user])

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
    },
    {
      id: 'users',
      label: 'Users',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      id: 'content',
      label: 'Content',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
    },
  ]

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.display_name || '').toLowerCase().includes(userSearch.toLowerCase())
  )

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
        <p className="mt-1 text-slate-400">Manage users, content, and site settings</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Tabs */}
        <div className="shrink-0 lg:w-48">
          <nav className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:w-full ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-6">
          {activeTab === 'overview' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/20">
                      <svg className="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Total Users</p>
                      <p className="text-2xl font-bold text-white">{stats.totalUsers.toLocaleString()}</p>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/20">
                      <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Total Threads</p>
                      <p className="text-2xl font-bold text-white">{stats.totalThreads.toLocaleString()}</p>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20">
                      <svg className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Total Posts</p>
                      <p className="text-2xl font-bold text-white">{stats.totalPosts.toLocaleString()}</p>
                    </div>
                  </div>
                </Card>
              </div>
            </>
          )}

          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="relative sm:max-w-xs">
                <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search users..."
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <Card className="overflow-hidden">
                <table className="w-full">
                  <thead className="border-b border-slate-700 bg-slate-800">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">User</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 sm:table-cell">Role</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 md:table-cell">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-700/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar seed={u.id} type="user" avatarUrl={u.avatar_url} size={32} />
                            <div>
                              <span className="font-medium text-white">{u.display_name || u.username}</span>
                              <p className="text-xs text-slate-400">@{u.username}</p>
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.is_admin ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'
                          }`}>
                            {u.is_admin ? 'Admin' : 'User'}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 text-sm text-slate-400 md:table-cell">{formatTimeAgo(u.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          {activeTab === 'content' && (
            <Card className="p-6 text-center">
              <p className="text-slate-400">Content moderation tools coming soon.</p>
              <Link to="/" className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300">
                View all threads
              </Link>
            </Card>
          )}

          {activeTab === 'reports' && (
            <Card className="p-6 text-center">
              <p className="text-slate-400">No reports to review.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
