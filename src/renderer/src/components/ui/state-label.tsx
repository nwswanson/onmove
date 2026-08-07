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
          'border-destructive/45 bg-destructive/12 text-destructive',
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
          model.tone === 'warning' && 'bg-destructive',
          model.tone === 'success' && 'bg-success',
          model.tone === 'neutral' && 'bg-muted-foreground'
        )}
        aria-hidden="true"
      />
      {model.label}
    </span>
  )
}
