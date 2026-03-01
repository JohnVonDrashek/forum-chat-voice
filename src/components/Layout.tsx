import { Outlet } from 'react-router-dom'
import { useState, useCallback } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import MobileSidebar from './MobileSidebar'
import type { Category } from '../types'

// Demo categories - shared between Sidebar and MobileSidebar
const demoCategories: Category[] = [
  { id: '1', name: 'General', slug: 'general', description: 'General discussion', sort_order: 0, created_at: '' },
  { id: '2', name: 'Announcements', slug: 'announcements', description: 'Official announcements', sort_order: 1, created_at: '' },
  { id: '3', name: 'Help & Support', slug: 'help', description: 'Get help from the community', sort_order: 2, created_at: '' },
  { id: '4', name: 'Showcase', slug: 'showcase', description: 'Show off your projects', sort_order: 3, created_at: '' },
]

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleMenuClick = useCallback(() => {
    setMobileMenuOpen(true)
  }, [])

  const handleMenuClose = useCallback(() => {
    setMobileMenuOpen(false)
  }, [])

  return (
    <div className="min-h-screen bg-slate-900">
      <Header onMenuClick={handleMenuClick} />

      {/* Mobile sidebar */}
      <MobileSidebar
        isOpen={mobileMenuOpen}
        onClose={handleMenuClose}
        categories={demoCategories}
      />

      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
