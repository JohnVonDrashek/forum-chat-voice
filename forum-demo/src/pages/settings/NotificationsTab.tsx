type EmailNotifs = {
  replies: boolean
  mentions: boolean
  likes: boolean
  follows: boolean
  directMessages: boolean
  newsletter: boolean
}

type PushNotifs = {
  replies: boolean
  mentions: boolean
  likes: boolean
  follows: boolean
  directMessages: boolean
}

interface NotificationsTabProps {
  emailNotifs: EmailNotifs
  setEmailNotifs: (notifs: EmailNotifs) => void
  pushNotifs: PushNotifs
  setPushNotifs: (notifs: PushNotifs) => void
}

export default function NotificationsTab({
  emailNotifs,
  setEmailNotifs,
  pushNotifs,
  setPushNotifs,
}: NotificationsTabProps) {
  return (
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
                role="switch"
                aria-checked={emailNotifs[item.key as keyof EmailNotifs]}
                aria-label={`Email notification for ${item.label}`}
                onClick={() => setEmailNotifs({ ...emailNotifs, [item.key]: !emailNotifs[item.key as keyof EmailNotifs] })}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  emailNotifs[item.key as keyof EmailNotifs] ? 'bg-indigo-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    emailNotifs[item.key as keyof EmailNotifs] ? 'translate-x-5' : ''
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
                role="switch"
                aria-checked={pushNotifs[item.key as keyof PushNotifs]}
                aria-label={`Push notification for ${item.label}`}
                onClick={() => setPushNotifs({ ...pushNotifs, [item.key]: !pushNotifs[item.key as keyof PushNotifs] })}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  pushNotifs[item.key as keyof PushNotifs] ? 'bg-indigo-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    pushNotifs[item.key as keyof PushNotifs] ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
