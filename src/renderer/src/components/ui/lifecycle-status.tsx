import { ChevronDown } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export type LifecycleStatusTone = 'primary' | 'neutral' | 'success' | 'danger'

/** Data-only contract consumed by lifecycle status labels and selectors. */
export interface LifecycleStatusOptionModel {
  value: string
  label: string
  tone: LifecycleStatusTone
}

function toneClasses(tone: LifecycleStatusTone): string {
  switch (tone) {
    case 'primary':
      return 'border-primary/65 bg-primary/25 text-primary-foreground'
    case 'neutral':
      return 'border-border bg-muted text-muted-foreground'
    case 'success':
      return 'border-success/50 bg-success/18 text-success-foreground'
    case 'danger':
      return 'border-destructive/50 bg-destructive/14 text-destructive'
  }
}

export interface LifecycleStatusLabelProps
  extends Omit<React.ComponentProps<'span'>, 'children'> {
  model: LifecycleStatusOptionModel
  size?: 'compact' | 'default'
}

export function LifecycleStatusLabel({
  model,
  size = 'default',
  className,
  ...props
}: LifecycleStatusLabelProps): React.JSX.Element {
  return (
    <span
      data-slot="lifecycle-status-label"
      data-status-tone={model.tone}
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border font-semibold',
        size === 'compact' ? 'px-1.5 py-0.5 text-[0.625rem]' : 'px-2 py-1 text-xs',
        toneClasses(model.tone),
        className
      )}
      {...props}
    >
      {model.label}
    </span>
  )
}

export interface LifecycleStatusSelectProps
  extends Omit<React.ComponentProps<'select'>, 'children' | 'onChange' | 'value'> {
  value: string
  options: readonly LifecycleStatusOptionModel[]
  onValueChange: (value: string) => void
}

/** Compact native selector styled as a Jira-like lifecycle status control. */
export function LifecycleStatusSelect({
  value,
  options,
  onValueChange,
  className,
  ...props
}: LifecycleStatusSelectProps): React.JSX.Element {
  const selected = options.find((option) => option.value === value)
  if (!selected) throw new Error(`Lifecycle status selector has no option for value "${value}".`)

  return (
    <span className="relative inline-flex shrink-0">
      <select
        data-slot="lifecycle-status-select"
        data-status-tone={selected.tone}
        className={cn(
          'h-8 cursor-pointer appearance-none rounded-md border py-1 pr-7 pl-2.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-wait disabled:opacity-65',
          toneClasses(selected.tone),
          className
        )}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2"
        aria-hidden="true"
      />
    </span>
  )
}
