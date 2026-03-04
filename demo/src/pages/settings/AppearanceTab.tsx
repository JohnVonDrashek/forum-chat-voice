interface AppearanceTabProps {
  theme: 'dark' | 'light' | 'system'
  setTheme: (theme: 'dark' | 'light' | 'system') => void
  fontSize: 'small' | 'medium' | 'large'
  setFontSize: (size: 'small' | 'medium' | 'large') => void
}

export default function AppearanceTab({
  theme,
  setTheme,
  fontSize,
  setFontSize,
}: AppearanceTabProps) {
  return (
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
              onClick={() => setTheme(t.id as 'dark' | 'light' | 'system')}
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
              onClick={() => setFontSize(f.id as 'small' | 'medium' | 'large')}
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
  )
}
