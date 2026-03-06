import { useState } from 'react'
import { hubSupabase } from '../App'
import Button from './ui/Button'
import Input from './ui/Input'

type AuthMode = 'signin' | 'signup' | 'forgot'

export default function HubAuth() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'forgot') {
        const { error: resetError } = await hubSupabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/reset-password',
        })
        if (resetError) throw resetError
        setResetSent(true)
      } else if (mode === 'signin') {
        const { error: signInError } = await hubSupabase.auth.signInWithPassword({
          email,
          password,
        })
        if (signInError) throw signInError
      } else {
        const { data, error: signUpError } = await hubSupabase.auth.signUp({
          email,
          password,
          options: {
            data: { username },
          },
        })
        if (signUpError) throw signUpError

        if (data.user) {
          const session = data.session
          if (session) {
            await fetch('/api/profiles', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ username }),
            })
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'forgot' && resetSent) {
    return (
      <div className="w-full max-w-sm">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20">
          <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white">Check your email</h3>
        <p className="mt-1 text-sm text-slate-400">
          We've sent a password reset link to <span className="font-medium text-white">{email}</span>
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Didn't receive the email? Check your spam folder or{' '}
          <button
            onClick={() => setResetSent(false)}
            className="text-indigo-400 hover:text-indigo-300"
          >
            try again
          </button>
        </p>
        <button
          onClick={() => { setMode('signin'); setResetSent(false); setError(null) }}
          className="mt-4 block w-full rounded-lg bg-slate-700 px-4 py-2 text-center font-medium text-white hover:bg-slate-600"
        >
          Back to Sign In
        </button>
      </div>
    )
  }

  const heading = mode === 'signin'
    ? 'Sign in to Forumline Hub'
    : mode === 'signup'
      ? 'Create Hub Account'
      : 'Reset Password'

  const subheading = mode === 'signin'
    ? 'Connect your hub account to enable cross-forum DMs'
    : mode === 'signup'
      ? 'Create an account to start messaging across forums'
      : "Enter your email and we'll send you a reset link"

  return (
    <div className="w-full max-w-sm">
      <h3 className="text-lg font-semibold text-white">{heading}</h3>
      <p className="mt-1 text-sm text-slate-400">{subheading}</p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        {mode === 'signup' && (
          <Input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Username"
            required
            className="w-full"
          />
        )}
        <Input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Email"
          required
          className="w-full"
        />
        {mode !== 'forgot' && (
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            required
            minLength={6}
            className="w-full"
          />
        )}

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading
            ? (mode === 'signin' ? 'Signing in...' : mode === 'signup' ? 'Creating account...' : 'Sending...')
            : (mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link')}
        </Button>
      </form>

      {mode === 'signin' && (
        <button
          onClick={() => { setMode('forgot'); setError(null) }}
          className="mt-2 text-sm text-slate-400 hover:text-slate-300"
        >
          Forgot password?
        </button>
      )}

      <button
        onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setResetSent(false) }}
        className="mt-3 block text-sm text-indigo-400 hover:text-indigo-300"
      >
        {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
      </button>
    </div>
  )
}
