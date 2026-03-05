import { useRef } from 'react'
import { type UseFormRegister, type FieldErrors } from 'react-hook-form'
import Avatar from '../../components/Avatar'
import Input from '../../components/ui/Input'

export type ProfileFormData = {
  displayName?: string
  bio?: string
  website?: string
}

interface ProfileTabProps {
  userId: string | undefined
  avatarUrl: string | null
  avatarUploading: boolean
  onAvatarFileSelected: (file: File) => void
  register: UseFormRegister<ProfileFormData>
  errors: FieldErrors<ProfileFormData>
}

export default function ProfileTab({
  userId,
  avatarUrl,
  avatarUploading,
  onAvatarFileSelected,
  register,
  errors,
}: ProfileTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Profile Information</h2>
        <p className="text-sm text-slate-400">Update your profile details</p>
      </div>

      <div className="flex items-center gap-4">
        <Avatar seed={userId || 'demo'} type="user" avatarUrl={avatarUrl} size={80} />
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              onAvatarFileSelected(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarUploading}
            className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
          >
            {avatarUploading ? 'Uploading...' : 'Change Avatar'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="settings-display-name" className="mb-1 block text-sm font-medium text-slate-300">Display Name</label>
          <Input
            type="text"
            id="settings-display-name"
            {...register('displayName')}
            className="w-full"
          />
          {errors.displayName && (
            <p className="text-red-400 text-sm mt-1">{errors.displayName.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="settings-bio" className="mb-1 block text-sm font-medium text-slate-300">Bio</label>
          <textarea
            id="settings-bio"
            {...register('bio')}
            rows={3}
            placeholder="Tell us about yourself..."
            className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {errors.bio && (
            <p className="text-red-400 text-sm mt-1">{errors.bio.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="settings-website" className="mb-1 block text-sm font-medium text-slate-300">Website</label>
          <Input
            type="url"
            id="settings-website"
            {...register('website')}
            placeholder="https://example.com"
            className="w-full"
          />
          {errors.website && (
            <p className="text-red-400 text-sm mt-1">{errors.website.message}</p>
          )}
        </div>
      </div>
    </div>
  )
}
