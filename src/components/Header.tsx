import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../lib/auth'

interface HeaderProps {
  onMenuClick?: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user, signOut, loading } = useAuth()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
      setSearchQuery('')
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-700 bg-slate-800/80 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {/* Mobile menu button */}
          <button
            onClick={onMenuClick}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white lg:hidden"
            aria-label="Toggle menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white">
            <svg className="h-8 w-8 text-indigo-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
            <span className="hidden sm:inline">Forum</span>
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="relative hidden md:block">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-64 rounded-lg border border-slate-600 bg-slate-700 px-4 py-1.5 text-sm text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-600 bg-slate-800 px-1.5 text-xs text-slate-400">
              /
            </kbd>
          </form>

          {/* Mobile search button */}
          <Link
            to="/search"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white md:hidden"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </Link>

          {/* Auth */}
          {loading ? (
            <div className="h-8 w-16 animate-pulse rounded bg-slate-700" />
          ) : user ? (
            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                to={`/u/${user.user_metadata?.username || 'me'}`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-700 sm:px-3"
              >
                <div className="h-6 w-6 rounded-full bg-indigo-500 flex items-center justify-center text-xs font-medium text-white">
                  {user.email?.[0].toUpperCase()}
                </div>
                <span className="hidden sm:inline">{user.user_metadata?.username || user.email}</span>
              </Link>
              <button
                onClick={signOut}
                className="hidden rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-700 hover:text-white sm:block"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="hidden rounded-lg px-4 py-1.5 text-sm text-slate-300 hover:bg-slate-700 sm:block"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 sm:px-4"
              >
                Sign Up
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
