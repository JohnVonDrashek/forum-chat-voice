import { memo } from 'react'

interface AvatarProps {
  seed?: string
  type?: 'user' | 'thread'
  size?: number
  className?: string
  avatarUrl?: string | null
  showGlobe?: boolean
}

function Avatar({ size = 40, className = '', avatarUrl, showGlobe }: AvatarProps) {
  const avatar = avatarUrl ? (
    <img
      src={avatarUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className={`rounded-full object-cover ${className}`}
      style={!className.includes('h-') ? { width: size, height: size } : undefined}
    />
  ) : (
    <div
      className={`flex items-center justify-center rounded-full bg-slate-600 text-slate-400 ${className}`}
      style={!className.includes('h-') ? { width: size, height: size } : undefined}
    >
      <svg className="h-1/2 w-1/2" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
      </svg>
    </div>
  )

  if (!showGlobe) return avatar

  const globeSize = Math.max(12, Math.round(size * 0.35))

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      {avatar}
      <svg
        className="absolute text-indigo-400"
        style={{
          width: globeSize,
          height: globeSize,
          bottom: -1,
          right: -1,
        }}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <circle cx="12" cy="12" r="11" fill="#1e293b" stroke="#1e293b" strokeWidth="3" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>
    </div>
  )
}

export default memo(Avatar)
