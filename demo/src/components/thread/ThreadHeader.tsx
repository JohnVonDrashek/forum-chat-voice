import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../Avatar'
import ImageCropModal from '../ImageCropModal'
import { uploadAvatar } from '../../lib/avatars'
import { getDataProvider } from '../../lib/data-provider'
import { queryKeys } from '../../lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { formatDate } from '../../lib/dateFormatters'
import type { ThreadWithAuthor } from '../../types'

interface ThreadHeaderProps {
  thread: ThreadWithAuthor
  postCount: number
  currentPage: number
  totalPages: number
  isBookmarked: boolean
  onToggleBookmark: () => void
  currentUserId?: string
}

export default function ThreadHeader({
  thread,
  postCount,
  currentPage,
  totalPages,
  isBookmarked,
  onToggleBookmark,
  currentUserId,
}: ThreadHeaderProps) {
  const queryClient = useQueryClient()
  const threadImageInputRef = useRef<HTMLInputElement>(null)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  return (
    <>
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
        <Link to="/" className="hover:text-white">Home</Link>
        <span>/</span>
        <Link to={`/c/${thread.category.slug}`} className="hover:text-white">{thread.category.name}</Link>
      </div>

      {/* Thread Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {thread.is_pinned && (
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                Pinned
              </span>
            )}
            {thread.is_locked && (
              <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
                Locked
              </span>
            )}
          </div>
          <button
            onClick={onToggleBookmark}
            aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
            aria-pressed={isBookmarked}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              isBookmarked
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill={isBookmarked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span className="hidden sm:inline">
              {isBookmarked ? 'Bookmarked' : 'Bookmark'}
            </span>
          </button>
        </div>
        <div className="mt-2 flex items-start gap-3">
          <div className="relative shrink-0">
            <Avatar seed={thread.id} type="thread" avatarUrl={thread.image_url} className="h-12 w-12" />
            {currentUserId === thread.author_id && (
              <button
                type="button"
                onClick={() => threadImageInputRef.current?.click()}
                disabled={avatarUploading}
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors"
                title="Change thread image"
              >
                {avatarUploading ? (
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                )}
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-white">{thread.title}</h1>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400 sm:gap-3">
          <span>Started by {thread.author.display_name || thread.author.username}</span>
          <span className="hidden sm:inline">·</span>
          <span>{formatDate(thread.created_at)}</span>
          <span>·</span>
          <span>{postCount} {postCount === 1 ? 'reply' : 'replies'}</span>
          {totalPages > 1 && (
            <>
              <span>·</span>
              <span>Page {currentPage} of {totalPages}</span>
            </>
          )}
        </div>
      </div>

      {/* Hidden file input for thread image change */}
      <input
        ref={threadImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            const reader = new FileReader()
            reader.onload = () => setCropImageSrc(reader.result as string)
            reader.readAsDataURL(file)
          }
          e.target.value = ''
        }}
      />

      {cropImageSrc && (
        <ImageCropModal
          imageSrc={cropImageSrc}
          onCrop={async (blob) => {
            setCropImageSrc(null)
            setAvatarUploading(true)
            try {
              const imageUrl = await uploadAvatar(blob, `thread/${thread.id}/custom.png`)
              if (imageUrl) {
                await getDataProvider().updateThread(thread.id, { image_url: imageUrl })
                // Update cache
                queryClient.setQueryData(queryKeys.thread(thread.id), { ...thread, image_url: imageUrl })
                toast.success('Thread image updated')
              } else {
                toast.error('Failed to upload thread image')
              }
            } catch {
              toast.error('Failed to upload thread image')
            }
            setAvatarUploading(false)
          }}
          onCancel={() => setCropImageSrc(null)}
        />
      )}
    </>
  )
}
