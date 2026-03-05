import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useCallback } from 'react'
import SidebarContent from './SidebarContent'
import type { Category, ChatChannel, VoiceRoom } from '../types'

interface MobileSidebarProps {
  isOpen: boolean
  onClose: () => void
  categories: Category[]
  channels: ChatChannel[]
  rooms: VoiceRoom[]
}

export default function MobileSidebar({ isOpen, onClose, categories, channels, rooms }: MobileSidebarProps) {
  const location = useLocation()
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Close sidebar on route change
  useEffect(() => {
    onClose()
  }, [location.pathname, onClose])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Focus trap when open
  const handleFocusTrap = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !sidebarRef.current) return
    const focusableElements = sidebarRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (focusableElements.length === 0) return
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault()
        lastElement.focus()
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault()
        firstElement.focus()
      }
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleFocusTrap)
    const closeBtn = sidebarRef.current?.querySelector<HTMLElement>('button[aria-label="Close menu"]')
    closeBtn?.focus()
    return () => document.removeEventListener('keydown', handleFocusTrap)
  }, [isOpen, handleFocusTrap])

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
        className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className="fixed inset-y-0 left-0 z-50 w-[85vw] max-w-72 bg-slate-800 shadow-xl lg:hidden"
      >
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

        <nav aria-label="Main navigation" className="h-[calc(100vh-3.5rem)] overflow-y-auto p-4">
          <SidebarContent
            categories={categories}
            channels={channels}
            rooms={rooms}
            mobile
          />
        </nav>
      </div>
    </>
  )
}
