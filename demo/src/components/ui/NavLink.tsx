import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

type ActiveVariant = 'primary' | 'secondary'

interface NavLinkProps {
  to: string
  children: ReactNode
  /** 'primary' = indigo active bg, 'secondary' = slate active bg */
  variant?: ActiveVariant
  /** Use startsWith instead of exact match for active detection */
  startsWith?: boolean
  /** Additional className when active (overrides variant) */
  activeClassName?: string
  /** Additional className when inactive (overrides variant) */
  inactiveClassName?: string
  /** Extra className always applied */
  className?: string
}

const variantStyles: Record<ActiveVariant, { active: string; inactive: string }> = {
  primary: {
    active: 'bg-indigo-600 text-white',
    inactive: 'text-slate-300 hover:bg-slate-700 hover:text-white',
  },
  secondary: {
    active: 'bg-slate-700 text-white',
    inactive: 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200',
  },
}

export default function NavLink({
  to,
  children,
  variant = 'secondary',
  startsWith = false,
  activeClassName,
  inactiveClassName,
  className = '',
}: NavLinkProps) {
  const location = useLocation()
  const isActive = startsWith
    ? location.pathname.startsWith(to)
    : location.pathname === to

  const styles = variantStyles[variant]
  const stateClass = isActive
    ? (activeClassName ?? styles.active)
    : (inactiveClassName ?? styles.inactive)

  return (
    <Link
      to={to}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${stateClass} ${className}`}
    >
      {children}
    </Link>
  )
}
