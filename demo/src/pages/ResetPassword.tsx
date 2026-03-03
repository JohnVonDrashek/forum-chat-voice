import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../lib/auth'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'

const resetPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>

export default function ResetPassword() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isValidSession, setIsValidSession] = useState(true)
  const { updatePassword, user } = useAuth()
  const navigate = useNavigate()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
  })

  // Check if user has a valid recovery session
  useEffect(() => {
    // If user is already set, session is valid
    if (user) {
      setIsValidSession(true)
      return
    }

    // Give Supabase a moment to process the recovery token from URL hash
    const timer = setTimeout(() => {
      if (!user) {
        setIsValidSession(false)
      }
    }, 2000)

    return () => clearTimeout(timer)
  }, [user])

  const onSubmit = async (data: ResetPasswordFormData) => {
    setError('')
    setLoading(true)

    const { error } = await updatePassword(data.password)
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
      // Redirect to home after a short delay
      setTimeout(() => navigate('/'), 2000)
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
          <h1 className="text-2xl font-bold text-white">Password Updated</h1>
          <p className="mt-2 text-slate-400">
            Your password has been successfully reset. Redirecting you to the home page...
          </p>
        </Card>
      </div>
    )
  }

  if (!isValidSession && !user) {
    return (
      <div className="mx-auto max-w-md">
        <Card className="p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
            <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Invalid or Expired Link</h1>
          <p className="mt-2 text-slate-400">
            This password reset link is invalid or has expired. Please request a new one.
          </p>
          <Link
            to="/forgot-password"
            className="mt-6 block w-full rounded-lg bg-indigo-600 px-4 py-2 text-center font-medium text-white hover:bg-indigo-500"
          >
            Request New Link
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md">
      <Card className="p-8">
        <h1 className="text-2xl font-bold text-white">Set New Password</h1>
        <p className="mt-2 text-slate-400">
          Enter your new password below.
        </p>

        <div aria-live="polite">
          {error && (
            <div id="reset-password-error" role="alert" className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">
              New Password
            </label>
            <Input
              type="password"
              id="password"
              {...register('password')}
              className="mt-1 block w-full"
              placeholder="Enter new password"
              aria-invalid={!!error}
              aria-describedby={error ? 'reset-password-error' : undefined}
            />
            {errors.password && (
              <p className="text-red-400 text-sm mt-1">{errors.password.message}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">At least 6 characters</p>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300">
              Confirm Password
            </label>
            <Input
              type="password"
              id="confirmPassword"
              {...register('confirmPassword')}
              className="mt-1 block w-full"
              placeholder="Confirm new password"
              aria-invalid={!!error}
              aria-describedby={error ? 'reset-password-error' : undefined}
            />
            {errors.confirmPassword && (
              <p className="text-red-400 text-sm mt-1">{errors.confirmPassword.message}</p>
            )}
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
