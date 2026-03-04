import { useState } from 'react'
import { hubSupabase } from '../App'
import Button from './ui/Button'
import Input from './ui/Input'

type AuthMode = 'signin' | 'signup'

export default function HubAuth() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'signin') {
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

  return (
    <div className="w-full max-w-sm">
      <h3 className="text-lg font-semibold text-white">
        {mode === 'signin' ? 'Sign in to Forumline Hub' : 'Create Hub Account'}
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        {mode === 'signin'
          ? 'Connect your hub account to enable cross-forum DMs'
          : 'Create an account to start messaging across forums'}
      </p>

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
        <Input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          required
          minLength={6}
          className="w-full"
        />

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading
            ? (mode === 'signin' ? 'Signing in...' : 'Creating account...')
            : (mode === 'signin' ? 'Sign In' : 'Create Account')}
        </Button>
      </form>

      <button
        onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
        className="mt-3 text-sm text-indigo-400 hover:text-indigo-300"
      >
        {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
      </button>
    </div>
  )
}
