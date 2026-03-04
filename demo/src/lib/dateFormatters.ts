/**
 * Shared date formatting utilities
 */

function toDate(date: string | Date): Date {
  return typeof date === 'string' ? new Date(date) : date
}

/**
 * Format a date as relative time.
 * - Default: "just now", "5m ago", "2h ago", "3d ago"
 * - short: "now", "5m", "2h", "3d" (falls back to locale date after 7d)
 */
export function formatRelativeTime(date: string | Date, opts?: { short?: boolean }): string {
  const diff = Date.now() - toDate(date).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (opts?.short) {
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    if (hours < 24) return `${hours}h`
    if (days < 7) return `${days}d`
    return toDate(date).toLocaleDateString()
  }

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

/**
 * Format a date as time only (e.g., "2:30 PM")
 */
export function formatTime(date: string | Date): string {
  return toDate(date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Format a date as full date (e.g., "Mar 2, 2026, 04:47 PM")
 */
export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Format a date as relative day label (e.g., "Today", "Yesterday", "Mar 2")
 */
export function formatDateLabel(date: string): string {
  const d = new Date(date)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString()) {
    return 'Today'
  } else if (d.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Backward-compatible aliases — use formatRelativeTime and formatTime instead
export const formatTimeAgo = (date: string) => formatRelativeTime(date)
export const formatShortTimeAgo = (date: Date) => formatRelativeTime(date, { short: true })
export const formatNotificationTime = (date: Date) => formatRelativeTime(date)
export const formatMessageTime = (date: Date) => formatTime(date)
