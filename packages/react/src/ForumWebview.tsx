/**
 * ForumWebview — Renders an external forum's website in an iframe.
 *
 * Used in the Tauri desktop app when a forum is selected from the ForumRail.
 * The iframe is sandboxed for security and keyed by domain for clean remounts.
 */

import { useState } from 'react'
import type { ForumMembership } from './ForumProvider'

interface ForumWebviewProps {
  forum: ForumMembership
}

export default function ForumWebview({ forum }: ForumWebviewProps) {
  const [loading, setLoading] = useState(true)

  return (
    <div className="relative flex-1">
      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-500" />
            <span className="text-sm text-slate-400">Loading {forum.name}...</span>
          </div>
        </div>
      )}

      <iframe
        key={forum.domain}
        src={forum.web_base}
        title={`${forum.name} forum`}
        className="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        allow="clipboard-read; clipboard-write"
        onLoad={() => setLoading(false)}
      />
    </div>
  )
}
