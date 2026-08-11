import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Receiver-owned contract for a compact semantic state label. Feature
 * presenters choose the words and semantic tone; this primitive owns all
 * markup and visual treatment.
 */
export interface StateLabelModel {
  label: string
  tone: 'danger' | 'warning' | 'success' | 'neutral'
}

export interface StateLabelProps extends Omit<ComponentProps<'span'>, 'children'> {
  model: StateLabelModel
  size?: 'compact' | 'default'
}

export interface StateDotProps extends Omit<ComponentProps<'span'>, 'children'> {
  model: StateLabelModel
}

/** Compact, text-free state receiver for dense tree and navigation rows. */
export function StateDot({
  model,
  className,
  ...props
}: StateDotProps): React.JSX.Element {
  return (
    <span
      role="img"
      aria-label={`${model.label} state`}
      title={model.label}
      data-tone={model.tone}
      className={cn(
        'size-2 shrink-0 rounded-full ring-1 ring-inset',
        model.tone === 'danger' && 'bg-destructive ring-destructive/35',
        model.tone === 'warning' && 'bg-warning ring-warning/45',
        model.tone === 'success' && 'bg-success ring-success/35',
        model.tone === 'neutral' && 'bg-muted-foreground/55 ring-border',
        className
      )}
      {...props}
    />
  )
}

export function StateLabel({
  model,
  size = 'default',
  className,
  ...props
}: StateLabelProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border font-semibold',
        size === 'compact'
          ? 'min-w-12 gap-1 px-1.5 py-0.5 text-[0.625rem]'
          : 'min-w-16 gap-1.5 px-2 py-0.5 text-[0.6875rem]',
        model.tone === 'danger' &&
          'border-destructive bg-destructive text-destructive-foreground',
        model.tone === 'warning' &&
          'border-warning/70 bg-warning/25 text-warning-foreground',
        model.tone === 'success' &&
          'border-success/45 bg-success/14 text-success-foreground',
        model.tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
        className
      )}
      data-tone={model.tone}
      {...props}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          model.tone === 'danger' && 'bg-destructive-foreground',
          model.tone === 'warning' && 'bg-warning',
          model.tone === 'success' && 'bg-success',
          model.tone === 'neutral' && 'bg-muted-foreground'
        )}
        aria-hidden="true"
      />
      {model.label}
    </span>
  )
}
