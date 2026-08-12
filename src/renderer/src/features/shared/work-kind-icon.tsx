import { GitBranch, Handshake, Target } from 'lucide-react'
import { cn } from '@/lib/utils'

export type WorkKind = 'focus' | 'thread' | 'commitment'

const WORK_KIND_LABELS = {
  focus: 'Focus',
  thread: 'Thread',
  commitment: 'Commitment'
} as const satisfies Record<WorkKind, string>

interface WorkKindIconProps {
  kind: WorkKind
  className?: string
}

/** Shared semantic glyph vocabulary for the three aggregate work levels. */
export function WorkKindIcon({ kind, className }: WorkKindIconProps): React.JSX.Element {
  const label = WORK_KIND_LABELS[kind]
  const Icon = kind === 'focus'
    ? Target
    : kind === 'thread'
      ? GitBranch
      : Handshake

  return (
    <span
      role="img"
      aria-label={`${label} type`}
      title={label}
      data-slot="work-kind-icon"
      data-work-kind={kind}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground',
        kind === 'focus' && 'text-primary-foreground',
        className
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  )
}
