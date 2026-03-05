import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import Card from './ui/Card'
import Skeleton from './ui/Skeleton'

interface RequireAuthProps {
  children: ReactNode
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <h3 className="mt-4 font-medium text-white">Sign in required</h3>
          <p className="mt-1 text-sm text-slate-400">You need to be logged in to view this page.</p>
          <Link
            to="/login"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Sign In
          </Link>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}

export function RedirectIfAuth({ children }: RequireAuthProps) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export function RequireAdmin({ children }: RequireAuthProps) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <h3 className="mt-4 font-medium text-white">Sign in required</h3>
          <p className="mt-1 text-sm text-slate-400">You need to be logged in to access the admin dashboard.</p>
          <Link
            to="/login"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Sign In
          </Link>
        </Card>
      </div>
    )
  }

  if (!profile?.is_admin) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          <h3 className="mt-4 font-medium text-white">Access denied</h3>
          <p className="mt-1 text-sm text-slate-400">You do not have admin privileges.</p>
          <Link
            to="/"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Go Home
          </Link>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}
