import SidebarContent from './SidebarContent'
import type { Category, ChatChannel, VoiceRoom } from '../types'

interface SidebarProps {
  categories: Category[]
  channels: ChatChannel[]
  rooms: VoiceRoom[]
}

export default function Sidebar({ categories, channels, rooms }: SidebarProps) {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 border-r border-slate-700 bg-slate-800/50 lg:block">
      <nav aria-label="Main navigation" className="h-full overflow-y-auto p-4">
        <SidebarContent
          categories={categories}
          channels={channels}
          rooms={rooms}
        />
      </nav>
    </aside>
  )
}
