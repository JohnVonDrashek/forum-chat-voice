import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const { resetPassword } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await resetPassword(email)
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="mx-auto max-w-md">
        <Card className="p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20">
            <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Check your email</h1>
          <p className="mt-2 text-slate-400">
            We've sent a password reset link to <span className="font-medium text-white">{email}</span>
          </p>
          <p className="mt-4 text-sm text-slate-500">
            Didn't receive the email? Check your spam folder or{' '}
            <button
              onClick={() => setSuccess(false)}
              className="text-indigo-400 hover:text-indigo-300"
            >
              try again
            </button>
          </p>
          <Link
            to="/login"
            className="mt-6 block w-full rounded-lg bg-slate-700 px-4 py-2 text-center font-medium text-white hover:bg-slate-600"
          >
            Back to Sign In
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md">
      <Card className="p-8">
        <h1 className="text-2xl font-bold text-white">Reset Password</h1>
        <p className="mt-2 text-slate-400">
          Enter your email address and we'll send you a link to reset your password.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-300">
              Email
            </label>
            <Input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full"
              placeholder="you@example.com"
              required
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Remember your password?{' '}
          <Link to="/login" className="text-indigo-400 hover:text-indigo-300">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  )
}
