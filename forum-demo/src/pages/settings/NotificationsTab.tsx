import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../lib/auth'

type NotificationCategory = 'reply' | 'mention' | 'chat_mention' | 'dm'

interface Preference {
  category: string
  enabled: boolean
}

const CATEGORIES: { key: NotificationCategory; label: string }[] = [
  { key: 'reply', label: 'Replies to your threads' },
  { key: 'mention', label: 'Mentions in posts' },
  { key: 'chat_mention', label: 'Mentions in chat' },
  { key: 'dm', label: 'Direct messages' },
]

export default function NotificationsTab() {
  const { getAccessToken } = useAuth()
  const queryClient = useQueryClient()

  const { data: prefs = [], isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const token = await getAccessToken()
      const res = await fetch('/api/notification-preferences', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch preferences')
      return res.json() as Promise<Preference[]>
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ category, enabled }: { category: string; enabled: boolean }) => {
      const token = await getAccessToken()
      const res = await fetch('/api/notification-preferences', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ category, enabled }),
      })
      if (!res.ok) throw new Error('Failed to update preference')
    },
    onMutate: async ({ category, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['notification-preferences'] })
      const previous = queryClient.getQueryData<Preference[]>(['notification-preferences'])
      queryClient.setQueryData<Preference[]>(['notification-preferences'], (old = []) => {
        const existing = old.find(p => p.category === category)
        if (existing) return old.map(p => p.category === category ? { ...p, enabled } : p)
        return [...old, { category, enabled }]
      })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notification-preferences'], context.previous)
      }
    },
  })

  function isEnabled(category: string): boolean {
    const pref = prefs.find(p => p.category === category)
    return pref ? pref.enabled : true // default on
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Notification Preferences</h2>
        <p className="text-sm text-slate-400">Choose which notifications you receive</p>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-400">Loading preferences...</div>
      ) : (
        <div className="space-y-3">
          {CATEGORIES.map((item) => (
            <label key={item.key} className="flex items-center justify-between">
              <span className="text-sm text-slate-300">{item.label}</span>
              <button
                role="switch"
                aria-checked={isEnabled(item.key)}
                aria-label={`Notification for ${item.label}`}
                onClick={() =>
                  toggleMutation.mutate({ category: item.key, enabled: !isEnabled(item.key) })
                }
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  isEnabled(item.key) ? 'bg-indigo-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    isEnabled(item.key) ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
