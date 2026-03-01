import { Link, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import type { Category } from '../types'

interface MobileSidebarProps {
  isOpen: boolean
  onClose: () => void
  categories: Category[]
}

export default function MobileSidebar({ isOpen, onClose, categories }: MobileSidebarProps) {
  const location = useLocation()

  // Close sidebar on route change
  useEffect(() => {
    onClose()
  }, [location.pathname, onClose])

  // Prevent body scroll when sidebar is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 z-50 w-72 bg-slate-800 shadow-xl lg:hidden">
        <div className="flex h-14 items-center justify-between border-b border-slate-700 px-4">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white" onClick={onClose}>
            <svg className="h-8 w-8 text-indigo-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
            <span>Forum</span>
          </Link>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
            aria-label="Close menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="h-[calc(100vh-3.5rem)] overflow-y-auto p-4">
          <div className="mb-4">
            <Link
              to="/"
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname === '/'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Home
            </Link>
          </div>

          <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Categories
          </div>
          <div className="space-y-1">
            {categories.map((category) => {
              const isActive = location.pathname === `/c/${category.slug}`
              return (
                <Link
                  key={category.id}
                  to={`/c/${category.slug}`}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-indigo-400" />
                  {category.name}
                </Link>
              )
            })}
          </div>

          {/* Chat Channels */}
          <div className="mt-6 mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Chat Channels
            <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-normal normal-case text-slate-400">
              Soon
            </span>
          </div>
          <div className="space-y-1 opacity-50">
            <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-500">
              <span className="text-green-400">#</span>
              general
            </div>
            <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-500">
              <span className="text-green-400">#</span>
              random
            </div>
          </div>

          {/* Voice Rooms */}
          <div className="mt-6 mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Voice Rooms
            <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-normal normal-case text-slate-400">
              Soon
            </span>
          </div>
          <div className="space-y-1 opacity-50">
            <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-500">
              <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0" />
              </svg>
              Lounge
            </div>
          </div>
        </nav>
      </div>
    </>
  )
}
