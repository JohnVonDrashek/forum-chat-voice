interface DesktopTabProps {
  launchAtLogin: boolean
  setLaunchAtLogin: (value: boolean) => void
  closeToTray: boolean
  setCloseToTray: (value: boolean) => void
  nativeNotifications: boolean
  setNativeNotifications: (value: boolean) => void
}

export default function DesktopTab({
  launchAtLogin,
  setLaunchAtLogin,
  closeToTray,
  setCloseToTray,
  nativeNotifications,
  setNativeNotifications,
}: DesktopTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Desktop Settings</h2>
        <p className="text-sm text-slate-400">Configure desktop app behavior</p>
      </div>

      <div className="space-y-4">
        <label className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-slate-300">Launch at login</span>
            <p className="text-xs text-slate-500">Start the app automatically when you log in</p>
          </div>
          <button
            role="switch"
            aria-checked={launchAtLogin}
            aria-label="Launch at login"
            onClick={() => setLaunchAtLogin(!launchAtLogin)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              launchAtLogin ? 'bg-indigo-600' : 'bg-slate-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                launchAtLogin ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </label>

        <label className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-slate-300">Close to tray</span>
            <p className="text-xs text-slate-500">Keep running in the background when the window is closed</p>
          </div>
          <button
            role="switch"
            aria-checked={closeToTray}
            aria-label="Close to tray"
            onClick={() => setCloseToTray(!closeToTray)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              closeToTray ? 'bg-indigo-600' : 'bg-slate-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                closeToTray ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </label>

        <label className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-slate-300">Native notifications</span>
            <p className="text-xs text-slate-500">Show system notifications for new messages</p>
          </div>
          <button
            role="switch"
            aria-checked={nativeNotifications}
            aria-label="Native notifications"
            onClick={() => setNativeNotifications(!nativeNotifications)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              nativeNotifications ? 'bg-indigo-600' : 'bg-slate-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                nativeNotifications ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </label>
      </div>
    </div>
  )
}
