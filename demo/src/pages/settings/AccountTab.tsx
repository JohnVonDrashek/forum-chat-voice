import { type UseFormRegister, type FieldErrors } from 'react-hook-form'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import Input from '../../components/ui/Input'

export type AccountFormData = {
  email: string
  currentPassword?: string
  newPassword?: string
  confirmPassword?: string
}

interface AccountTabProps {
  userId: string | undefined
  forumlineId: string | null | undefined
  register: UseFormRegister<AccountFormData>
  errors: FieldErrors<AccountFormData>
}

export default function AccountTab({
  userId,
  forumlineId,
  register,
  errors,
}: AccountTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Account Settings</h2>
        <p className="text-sm text-slate-400">Manage your email and password</p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="settings-email" className="mb-1 block text-sm font-medium text-slate-300">Email Address</label>
          <Input
            type="email"
            id="settings-email"
            {...register('email')}
            className="w-full"
          />
          {errors.email && (
            <p className="text-red-400 text-sm mt-1">{errors.email.message}</p>
          )}
        </div>
      </div>

      <div className="border-t border-slate-700 pt-6">
        <h3 className="mb-4 font-medium text-white">Change Password</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="settings-current-password" className="mb-1 block text-sm font-medium text-slate-300">Current Password</label>
            <Input
              type="password"
              id="settings-current-password"
              {...register('currentPassword')}
              className="w-full"
            />
            {errors.currentPassword && (
              <p className="text-red-400 text-sm mt-1">{errors.currentPassword.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="settings-new-password" className="mb-1 block text-sm font-medium text-slate-300">New Password</label>
            <Input
              type="password"
              id="settings-new-password"
              {...register('newPassword')}
              className="w-full"
            />
            {errors.newPassword && (
              <p className="text-red-400 text-sm mt-1">{errors.newPassword.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="settings-confirm-password" className="mb-1 block text-sm font-medium text-slate-300">Confirm New Password</label>
            <Input
              type="password"
              id="settings-confirm-password"
              {...register('confirmPassword')}
              className="w-full"
            />
            {errors.confirmPassword && (
              <p className="text-red-400 text-sm mt-1">{errors.confirmPassword.message}</p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-700 pt-6">
        <h3 className="mb-4 font-medium text-white">Forumline Connection</h3>
        {forumlineId ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-green-400">Connected to Forumline</span>
            </div>
            <button
              onClick={async () => {
                if (!userId) return
                const { error } = await supabase
                  .from('profiles')
                  .update({ forumline_id: null })
                  .eq('id', userId)
                if (error) {
                  toast.error('Failed to disconnect: ' + error.message)
                  return
                }
                // Clear httpOnly Forumline cookies (hub session)
                await fetch('/api/forumline/auth/session', { method: 'DELETE' }).catch(() => {})
                toast.success('Disconnected from Forumline')
                window.location.reload()
              }}
              className="text-sm text-slate-400 hover:text-red-400 underline"
            >
              Disconnect from Forumline
            </button>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-slate-400">
              Connect your account to Forumline to enable cross-forum direct messages and a unified identity across forums.
            </p>
            <button
              onClick={async () => {
                const { data: { session } } = await supabase.auth.getSession()
                if (!session?.access_token) {
                  toast.error('Session expired. Please sign in again.')
                  return
                }
                window.location.href = `/api/forumline/auth?link_token=${session.access_token}`
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-600/10 px-4 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-600/20"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              Connect to Forumline
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-slate-700 pt-6">
        <h3 className="mb-2 font-medium text-red-400">Danger Zone</h3>
        <p className="mb-4 text-sm text-slate-400">Permanently delete your account and all data</p>
        <button className="rounded-lg border border-red-600 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-600/10">
          Delete Account
        </button>
      </div>
    </div>
  )
}
