import { HTMLAttributes, forwardRef } from 'react'

const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className = '', children, ...props }, ref) => (
    <div
      ref={ref}
      className={`rounded-xl border border-slate-700 bg-slate-800/50 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
)

Card.displayName = 'Card'
export default Card
