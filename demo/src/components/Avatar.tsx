import { memo } from 'react'

interface AvatarProps {
  seed?: string
  type?: 'user' | 'thread'
  size?: number
  className?: string
  avatarUrl?: string | null
}

function Avatar({ size = 40, className = '', avatarUrl }: AvatarProps) {
  if (!avatarUrl) {
    // Generic placeholder when no avatar URL is available
    return (
      <div
        className={`flex items-center justify-center rounded-full bg-slate-600 text-slate-400 ${className}`}
        style={!className.includes('h-') ? { width: size, height: size } : undefined}
      >
        <svg className="h-1/2 w-1/2" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
        </svg>
      </div>
    )
  }

  return (
    <img
      src={avatarUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className={`rounded-full object-cover ${className}`}
      style={!className.includes('h-') ? { width: size, height: size } : undefined}
    />
  )
}

export default memo(Avatar)
