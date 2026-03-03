import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { uploadAvatar } from '../lib/avatars'
import Avatar from '../components/Avatar'
import ImageCropModal from '../components/ImageCropModal'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'

type Tab = 'profile' | 'account' | 'notifications' | 'appearance'

export default function Settings() {
  const { user, profile } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Profile state
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [website, setWebsite] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Account state
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Load profile data
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || profile.username || '')
      setBio(profile.bio || '')
      setWebsite(profile.website || '')
      setAvatarUrl(profile.avatar_url || null)
    } else if (user) {
      setDisplayName(user.user_metadata?.username || '')
    }
    setEmail(user?.email || '')
  }, [profile, user])

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

  const handleSave = async () => {
    setError('')

    if (user) {
      if (activeTab === 'profile') {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            display_name: displayName || null,
            bio: bio || null,
            website: website || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id)

        if (updateError) {
          setError(updateError.message)
          return
        }
      }

      if (activeTab === 'account' && newPassword) {
        if (newPassword !== confirmPassword) {
          setError('Passwords do not match')
          return
        }
        const { error: pwError } = await supabase.auth.updateUser({ password: newPassword })
        if (pwError) {
          setError(pwError.message)
          return
        }
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      }

      if (activeTab === 'notifications') {
        localStorage.setItem('emailNotifs', JSON.stringify(emailNotifs))
        localStorage.setItem('pushNotifs', JSON.stringify(pushNotifs))
      }

      if (activeTab === 'appearance') {
        localStorage.setItem('theme', theme)
        localStorage.setItem('fontSize', fontSize)
      }
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    {
      id: 'profile',
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
      id: 'appearance',
      label: 'Appearance',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-slate-400">Manage your account preferences</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Tabs - Mobile: horizontal scroll, Desktop: vertical sidebar */}
        <div className="shrink-0 lg:w-48">
          <nav className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
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
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Profile Information</h2>
                <p className="text-sm text-slate-400">Update your profile details</p>
              </div>

              <div className="flex items-center gap-4">
                <Avatar seed={user?.id || 'demo'} type="user" avatarUrl={avatarUrl} size={80} />
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = () => setCropImageSrc(reader.result as string)
                      reader.readAsDataURL(file)
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
                  <label className="mb-1 block text-sm font-medium text-slate-300">Display Name</label>
                  <Input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">Bio</label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={3}
                    placeholder="Tell us about yourself..."
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">Website</label>
                  <Input
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Account Tab */}
          {activeTab === 'account' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Account Settings</h2>
                <p className="text-sm text-slate-400">Manage your email and password</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">Email Address</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="border-t border-slate-700 pt-6">
                <h3 className="mb-4 font-medium text-white">Change Password</h3>
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-300">Current Password</label>
                    <Input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-300">New Password</label>
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-300">Confirm New Password</label>
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-700 pt-6">
                <h3 className="mb-2 font-medium text-red-400">Danger Zone</h3>
                <p className="mb-4 text-sm text-slate-400">Permanently delete your account and all data</p>
                <button className="rounded-lg border border-red-600 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-600/10">
                  Delete Account
                </button>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Notification Preferences</h2>
                <p className="text-sm text-slate-400">Choose how you want to be notified</p>
              </div>

              <div>
                <h3 className="mb-4 font-medium text-white">Email Notifications</h3>
                <div className="space-y-3">
                  {[
                    { key: 'replies', label: 'Replies to your posts' },
                    { key: 'mentions', label: 'Mentions of your username' },
                    { key: 'likes', label: 'Likes on your posts' },
                    { key: 'follows', label: 'New followers' },
                    { key: 'directMessages', label: 'Direct messages' },
                    { key: 'newsletter', label: 'Newsletter and updates' },
                  ].map((item) => (
                    <label key={item.key} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{item.label}</span>
                      <button
                        onClick={() => setEmailNotifs({ ...emailNotifs, [item.key]: !emailNotifs[item.key as keyof typeof emailNotifs] })}
                        className={`relative h-6 w-11 rounded-full transition-colors ${
                          emailNotifs[item.key as keyof typeof emailNotifs] ? 'bg-indigo-600' : 'bg-slate-600'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                            emailNotifs[item.key as keyof typeof emailNotifs] ? 'translate-x-5' : ''
                          }`}
                        />
                      </button>
                    </label>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-700 pt-6">
                <h3 className="mb-4 font-medium text-white">Push Notifications</h3>
                <div className="space-y-3">
                  {[
                    { key: 'replies', label: 'Replies to your posts' },
                    { key: 'mentions', label: 'Mentions of your username' },
                    { key: 'likes', label: 'Likes on your posts' },
                    { key: 'follows', label: 'New followers' },
                    { key: 'directMessages', label: 'Direct messages' },
                  ].map((item) => (
                    <label key={item.key} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{item.label}</span>
                      <button
                        onClick={() => setPushNotifs({ ...pushNotifs, [item.key]: !pushNotifs[item.key as keyof typeof pushNotifs] })}
                        className={`relative h-6 w-11 rounded-full transition-colors ${
                          pushNotifs[item.key as keyof typeof pushNotifs] ? 'bg-indigo-600' : 'bg-slate-600'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                            pushNotifs[item.key as keyof typeof pushNotifs] ? 'translate-x-5' : ''
                          }`}
                        />
                      </button>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Appearance Tab */}
          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Appearance</h2>
                <p className="text-sm text-slate-400">Customize how the forum looks</p>
              </div>

              <div>
                <h3 className="mb-3 font-medium text-white">Theme</h3>
                <div className="flex gap-3">
                  {[
                    { id: 'dark', label: 'Dark', icon: '🌙' },
                    { id: 'light', label: 'Light', icon: '☀️' },
                    { id: 'system', label: 'System', icon: '💻' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id as typeof theme)}
                      className={`flex flex-1 flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                        theme === t.id
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : 'border-slate-600 hover:border-slate-500'
                      }`}
                    >
                      <span className="text-2xl">{t.icon}</span>
                      <span className="text-sm font-medium text-white">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-700 pt-6">
                <h3 className="mb-3 font-medium text-white">Font Size</h3>
                <div className="flex gap-3">
                  {[
                    { id: 'small', label: 'Small', sample: 'Aa' },
                    { id: 'medium', label: 'Medium', sample: 'Aa' },
                    { id: 'large', label: 'Large', sample: 'Aa' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setFontSize(f.id as typeof fontSize)}
                      className={`flex flex-1 flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                        fontSize === f.id
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : 'border-slate-600 hover:border-slate-500'
                      }`}
                    >
                      <span className={`font-medium text-white ${f.id === 'small' ? 'text-sm' : f.id === 'large' ? 'text-xl' : 'text-base'}`}>
                        {f.sample}
                      </span>
                      <span className="text-sm font-medium text-white">{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-700 pt-6">
            {error && (
              <span className="text-sm text-red-400">{error}</span>
            )}
            {saved && (
              <span className="text-sm text-green-400">Settings saved!</span>
            )}
            <button
              onClick={handleSave}
              className="rounded-lg bg-indigo-600 px-6 py-2 font-medium text-white hover:bg-indigo-500"
            >
              Save Changes
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
            setError('')
            const file = new File([blob], 'avatar.png', { type: 'image/png' })
            const path = `user/${user.id}/custom.png`
            const url = await uploadAvatar(file, path)
            if (url) {
              await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id)
              setAvatarUrl(url)
            } else {
              setError('Failed to upload avatar')
            }
            setAvatarUploading(false)
          }}
        />
      )}
    </div>
  )
}
