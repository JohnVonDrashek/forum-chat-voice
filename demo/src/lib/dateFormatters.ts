/**
 * Shared date formatting utilities
 */

/**
 * Format a date as relative time (e.g., "just now", "5m ago", "2h ago", "3d ago")
 */
export function formatTimeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Format a date as time only (e.g., "2:30 PM")
 */
export function formatTime(date: string): string {
  return new Date(date).toLocaleTimeString('en-US', {
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

/**
 * Format a Date object as short relative time (e.g., "now", "5m", "2h", "3d")
 */
export function formatShortTimeAgo(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return date.toLocaleDateString()
}

/**
 * Format a Date object as time only (e.g., "2:30 PM")
 */
export function formatMessageTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Format a Date object as relative time with "ago" suffix (e.g., "now", "5m ago", "2h ago")
 */
export function formatNotificationTime(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}
