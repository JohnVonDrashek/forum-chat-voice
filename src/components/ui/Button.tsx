import { ButtonHTMLAttributes, forwardRef } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50',
  secondary: 'bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-500 disabled:opacity-50',
  ghost: 'text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className = '', children, ...props }, ref) => (
    <button
      ref={ref}
      className={`rounded-lg px-4 py-2 font-medium transition-colors ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
)

Button.displayName = 'Button'
export default Button
