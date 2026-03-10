import { describe, expect, it, vi, afterEach } from 'vitest'
import { formatShortTimeAgo, formatMessageTime } from './dateFormatters.js'

describe('formatShortTimeAgo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "now" for less than 1 minute ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:30Z'))
    const date = new Date('2025-01-15T12:00:00Z')
    expect(formatShortTimeAgo(date)).toBe('now')
  })

  it('returns minutes for < 60 min', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:05:00Z'))
    const date = new Date('2025-01-15T12:00:00Z')
    expect(formatShortTimeAgo(date)).toBe('5m')
  })

  it('returns hours for < 24 hours', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T15:00:00Z'))
    const date = new Date('2025-01-15T12:00:00Z')
    expect(formatShortTimeAgo(date)).toBe('3h')
  })

  it('returns days for < 7 days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-17T12:00:00Z'))
    const date = new Date('2025-01-15T12:00:00Z')
    expect(formatShortTimeAgo(date)).toBe('2d')
  })

  it('returns locale date for >= 7 days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-25T12:00:00Z'))
    const date = new Date('2025-01-10T12:00:00Z')
    const result = formatShortTimeAgo(date)
    // Should be a locale date string, not a relative format
    expect(result).not.toMatch(/^\d+[mhd]$/)
    expect(result).not.toBe('now')
  })
})

describe('formatMessageTime', () => {
  it('formats time with hour and minute', () => {
    const date = new Date('2025-01-15T14:30:00Z')
    const result = formatMessageTime(date)
    // Should contain a colon (hour:minute format)
    expect(result).toContain(':')
    expect(result).toContain('30')
  })
})
