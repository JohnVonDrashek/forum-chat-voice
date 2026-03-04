import { useState, useEffect, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../lib/auth'
import { useHub } from '@johnvondrashek/forumline-react'
import { supabase } from '../lib/supabase'
import { getDataProvider } from '../lib/data-provider'
import { uploadAvatar } from '../lib/avatars'
import ImageCropModal from '../components/ImageCropModal'
import Card from '../components/ui/Card'
import { isTauri, getTauriAutostart, getTauriNotification } from '@johnvondrashek/forumline-react'
import { invoke } from '@tauri-apps/api/core'
import ProfileTab, { type ProfileFormData } from './settings/ProfileTab'
import AccountTab, { type AccountFormData } from './settings/AccountTab'
import NotificationsTab from './settings/NotificationsTab'
import AppearanceTab from './settings/AppearanceTab'
import DesktopTab from './settings/DesktopTab'

type Tab = 'profile' | 'account' | 'notifications' | 'appearance' | 'desktop'

const profileSchema = z.object({
  displayName: z.string().optional(),
  bio: z.string().optional(),
  website: z.string().url('Please enter a valid URL').optional().or(z.literal('')),
})

const accountSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email'),
  currentPassword: z.string().optional(),
  newPassword: z.string().optional(),
  confirmPassword: z.string().optional(),
}).refine((data) => {
  if (data.newPassword && data.newPassword.length < 6) return false
  return true
}, {
  message: 'New password must be at least 6 characters',
  path: ['newPassword'],
}).refine((data) => {
  if (data.newPassword && data.newPassword !== data.confirmPassword) return false
  return true
}, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

export default function Settings() {
  const { user, profile } = useAuth()
  const { reconnect } = useHub()
  const [activeTab, setActiveTab] = useState<Tab>('profile')

  // Handle ?forumline_linked=true query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('forumline_linked') === 'true') {
      toast.success('Forumline account connected successfully!')
      params.delete('forumline_linked')
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname
      window.history.replaceState({}, '', newUrl)
      setActiveTab('account')
      // Re-initialize hub connection
      reconnect?.()
    }
  }, [])

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)

  // Profile form
  const {
    register: registerProfile,
    handleSubmit: handleSubmitProfile,
    reset: resetProfile,
    formState: { errors: profileErrors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
  })

  // Account form
  const {
    register: registerAccount,
    handleSubmit: handleSubmitAccount,
    reset: resetAccount,
    formState: { errors: accountErrors },
  } = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
  })

  // Load profile data
  useEffect(() => {
    if (profile) {
      resetProfile({
        displayName: profile.display_name || profile.username || '',
        bio: profile.bio || '',
        website: profile.website || '',
      })
      setAvatarUrl(profile.avatar_url || null)
    } else if (user) {
      resetProfile({
        displayName: user.user_metadata?.username || '',
        bio: '',
        website: '',
      })
    }
    resetAccount({
      email: user?.email || '',
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    })
  }, [profile, user, resetProfile, resetAccount])

  // Notification state - persisted to localStorage
  const [emailNotifs, setEmailNotifs] = useState(() => {
    const saved = localStorage.getItem('emailNotifs')
    return saved ? JSON.parse(saved) : {
      replies: true,
      mentions: true,
      likes: false,
      follows: true,
      directMessages: true,
      newsletter: false,
    }
  })
  const [pushNotifs, setPushNotifs] = useState(() => {
    const saved = localStorage.getItem('pushNotifs')
    return saved ? JSON.parse(saved) : {
      replies: true,
      mentions: true,
      likes: true,
      follows: false,
      directMessages: true,
    }
  })

  // Appearance state - persisted to localStorage
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {
    const saved = localStorage.getItem('theme')
    return (saved as 'dark' | 'light' | 'system') || 'dark'
  })
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>(() => {
    const saved = localStorage.getItem('fontSize')
    return (saved as 'small' | 'medium' | 'large') || 'medium'
  })

  // Desktop settings (only relevant in Tauri)
  const [launchAtLogin, setLaunchAtLogin] = useState(() => {
    return localStorage.getItem('launchAtLogin') === 'true'
  })
  const [closeToTray, setCloseToTray] = useState(() => {
    return localStorage.getItem('closeToTray') !== 'false'
  })
  const [nativeNotifications, setNativeNotifications] = useState(() => {
    return localStorage.getItem('nativeNotifications') !== 'false'
  })

  // Sync autostart state from system on mount
  useEffect(() => {
    if (!isTauri()) return
    getTauriAutostart().then(async ({ isEnabled }) => {
      const enabled = await isEnabled()
      setLaunchAtLogin(enabled)
      localStorage.setItem('launchAtLogin', String(enabled))
    }).catch(() => {})
  }, [])

  const saveMutation = useMutation({
    mutationFn: async (data: ProfileFormData | AccountFormData | undefined) => {
      if (!user) throw new Error('Not authenticated')

      if (activeTab === 'profile' && data) {
        const profileData = data as ProfileFormData
        await getDataProvider().updateProfile(user.id, {
          display_name: profileData.displayName || null,
          bio: profileData.bio || null,
          website: profileData.website || null,
        })
      }

      if (activeTab === 'account' && data) {
        const accountData = data as AccountFormData
        if (accountData.newPassword) {
          const { error: pwError } = await supabase.auth.updateUser({ password: accountData.newPassword })
          if (pwError) throw new Error(pwError.message)
          resetAccount({
            email: accountData.email,
            currentPassword: '',
            newPassword: '',
            confirmPassword: '',
          })
        }
      }

      if (activeTab === 'notifications') {
        localStorage.setItem('emailNotifs', JSON.stringify(emailNotifs))
        localStorage.setItem('pushNotifs', JSON.stringify(pushNotifs))
      }

      if (activeTab === 'appearance') {
        localStorage.setItem('theme', theme)
        localStorage.setItem('fontSize', fontSize)
      }

      if (activeTab === 'desktop') {
        localStorage.setItem('launchAtLogin', String(launchAtLogin))
        localStorage.setItem('closeToTray', String(closeToTray))
        localStorage.setItem('nativeNotifications', String(nativeNotifications))

        if (isTauri()) {
          // Toggle autostart
          const { enable, disable } = await getTauriAutostart()
          if (launchAtLogin) {
            await enable()
          } else {
            await disable()
          }

          // Toggle close-to-tray via Rust IPC
          await invoke('set_close_to_tray', { enabled: closeToTray })

          // Request notification permission if enabled
          if (nativeNotifications) {
            const { isPermissionGranted, requestPermission } = await getTauriNotification()
            const permitted = await isPermissionGranted()
            if (!permitted) {
              await requestPermission()
            }
          }
        }
      }
    },
    onSuccess: () => {
      toast.success('Settings saved')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to save settings')
    },
  })

  const handleSave = () => {
    if (activeTab === 'profile') {
      handleSubmitProfile((data) => saveMutation.mutate(data))()
    } else if (activeTab === 'account') {
      handleSubmitAccount((data) => saveMutation.mutate(data))()
    } else {
      saveMutation.mutate(undefined)
    }
  }

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = ([
    {
      id: 'profile' as Tab,
      label: 'Profile',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      id: 'account',
      label: 'Account',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
    },
    {
      id: 'appearance' as Tab,
      label: 'Appearance',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      ),
    },
  ] as { id: Tab; label: string; icon: ReactNode }[]).concat(
    isTauri()
      ? [
          {
            id: 'desktop' as Tab,
            label: 'Desktop',
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            ),
          },
        ]
      : []
  )

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-slate-400">Manage your account preferences</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Tabs - Mobile: horizontal scroll, Desktop: vertical sidebar */}
        <div className="shrink-0 lg:w-48">
          <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:w-full ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <Card className="flex-1 p-6">
          {activeTab === 'profile' && (
            <ProfileTab
              userId={user?.id}
              avatarUrl={avatarUrl}
              avatarUploading={avatarUploading}
              onAvatarFileSelected={(file) => {
                const reader = new FileReader()
                reader.onload = () => setCropImageSrc(reader.result as string)
                reader.readAsDataURL(file)
              }}
              register={registerProfile}
              errors={profileErrors}
            />
          )}

          {activeTab === 'account' && (
            <AccountTab
              userId={user?.id}
              forumlineId={profile?.forumline_id}
              register={registerAccount}
              errors={accountErrors}
            />
          )}

          {activeTab === 'notifications' && (
            <NotificationsTab
              emailNotifs={emailNotifs}
              setEmailNotifs={setEmailNotifs}
              pushNotifs={pushNotifs}
              setPushNotifs={setPushNotifs}
            />
          )}

          {activeTab === 'appearance' && (
            <AppearanceTab
              theme={theme}
              setTheme={setTheme}
              fontSize={fontSize}
              setFontSize={setFontSize}
            />
          )}

          {activeTab === 'desktop' && (
            <DesktopTab
              launchAtLogin={launchAtLogin}
              setLaunchAtLogin={setLaunchAtLogin}
              closeToTray={closeToTray}
              setCloseToTray={setCloseToTray}
              nativeNotifications={nativeNotifications}
              setNativeNotifications={setNativeNotifications}
            />
          )}

          {/* Save Button */}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-700 pt-6">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="rounded-lg bg-indigo-600 px-6 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </Card>
      </div>

      {cropImageSrc && (
        <ImageCropModal
          imageSrc={cropImageSrc}
          onCancel={() => setCropImageSrc(null)}
          onCrop={async (blob) => {
            setCropImageSrc(null)
            if (!user) return
            setAvatarUploading(true)
            saveMutation.reset()
            const file = new File([blob], 'avatar.png', { type: 'image/png' })
            const path = `user/${user.id}/custom.png`
            const url = await uploadAvatar(file, path)
            if (url) {
              await getDataProvider().updateProfile(user.id, { avatar_url: url })
              setAvatarUrl(url)
              toast.success('Avatar updated')
            } else {
              toast.error('Failed to upload avatar')
              console.error('[FLD:Settings] Failed to upload avatar')
            }
            setAvatarUploading(false)
          }}
        />
      )}
    </div>
  )
}
