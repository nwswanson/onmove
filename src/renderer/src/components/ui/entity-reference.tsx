import { cn } from '@/lib/utils'

export interface EntityReferenceModel {
  value: string
  label: string
}

/** Compact, selectable public id for a user-addressable record. */
export function EntityReference({
  value,
  label,
  className
}: EntityReferenceModel & { className?: string }): React.JSX.Element {
  return (
    <span
      data-slot="entity-reference"
      title={`${label} ${value}`}
      aria-label={`${label} ${value}`}
      className={cn(
        'inline-flex h-5 shrink-0 select-text items-center rounded-md border border-border/70 bg-muted/35 px-1.5 font-mono text-[0.625rem] font-medium leading-none tracking-[-0.01em] tabular-nums text-muted-foreground',
        className
      )}
    >
      {value}
    </span>
  )
}
