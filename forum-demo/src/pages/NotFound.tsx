import { Link } from 'react-router-dom'
import Card from '../components/ui/Card'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-4xl">
      <Card className="p-8 text-center">
        <svg className="mx-auto h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="mt-4 text-2xl font-bold text-white">Page not found</h3>
        <p className="mt-2 text-sm text-slate-400">The page you're looking for doesn't exist or has been moved.</p>
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
