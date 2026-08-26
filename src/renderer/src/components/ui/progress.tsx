import type * as React from 'react'
import { cn } from '@/lib/utils'

interface ProgressProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  value?: number | null
  max?: number
}

function Progress({
  value = null,
  max = 100,
  className,
  ...props
}: ProgressProps): React.JSX.Element {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100
  const determinate = value !== null && Number.isFinite(value)
  const safeValue = determinate ? Math.max(0, Math.min(Number(value), safeMax)) : null
  const percentage = safeValue === null ? null : (safeValue / safeMax) * 100

  return (
    <div
      data-slot="progress"
      data-state={determinate ? 'determinate' : 'indeterminate'}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      {...(safeValue === null ? {} : { 'aria-valuenow': safeValue })}
      className={cn('h-2 overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn(
          'h-full rounded-full bg-primary transition-[width] duration-200',
          percentage === null && 'w-1/3 animate-pulse motion-reduce:animate-none'
        )}
        style={percentage === null ? undefined : { width: `${percentage}%` }}
      />
    </div>
  )
}

export { Progress }
