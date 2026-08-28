import {
  CheckSquare2,
  FileText,
  GitBranch,
  Handshake,
  LockKeyhole,
  Repeat2
} from 'lucide-react'
import type { CanvasCardModel, CanvasCardTone } from '@/features/canvas/canvas-presenters'
import { cn } from '@/lib/utils'

interface CanvasEntityWidgetProps {
  model: CanvasCardModel
  compact?: boolean
}

const TONE_CLASSES: Record<CanvasCardTone, string> = {
  primary: 'border-primary/45 bg-primary/18 text-foreground',
  success: 'border-success/45 bg-success/14 text-success-foreground',
  warning: 'border-warning/70 bg-warning/25 text-warning-foreground',
  destructive: 'border-destructive/45 bg-destructive/12 text-destructive',
  muted: 'border-border bg-muted text-muted-foreground'
}

function KindIcon({ kind }: { kind: CanvasCardModel['kind'] }): React.JSX.Element {
  const Icon = kind === 'thread'
    ? GitBranch
    : kind === 'commitment'
      ? Handshake
      : kind === 'routine'
        ? Repeat2
        : kind === 'note'
          ? FileText
          : CheckSquare2
  return <Icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
}

/**
 * OnMove-owned React content rendered inside an Excalidraw embeddable. The
 * element shell owns geometry; this receiver owns only shadcn-style content.
 */
export function CanvasEntityWidget({
  model,
  compact = false
}: CanvasEntityWidgetProps): React.JSX.Element {
  return (
    <article
      className={cn(
        'pointer-events-none flex size-full select-none overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm',
        model.deleted && 'border-dashed border-muted-foreground/55 bg-muted/35 opacity-80 shadow-none'
      )}
      aria-label={`${model.deleted ? 'Deleted ' : ''}${model.kindLabel}: ${model.title}`}
    >
      <div
        className={cn(
          'w-1.5 shrink-0 bg-primary',
          model.statusTone === 'success' && 'bg-success',
          model.statusTone === 'warning' && 'bg-warning',
          model.statusTone === 'destructive' && 'bg-destructive',
          model.statusTone === 'muted' && 'bg-muted-foreground/45'
        )}
        aria-hidden="true"
      />
      <div className={cn('flex min-w-0 flex-1 flex-col p-4', compact && 'p-3')}>
        <header className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/60 text-muted-foreground shadow-xs">
            <KindIcon kind={model.kind} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {model.kindLabel}
              </span>
              {model.sensitive && (
                <LockKeyhole className="size-3 text-muted-foreground" aria-label="Sensitive" />
              )}
            </span>
            <span className="mt-0.5 block truncate text-[0.9375rem] font-semibold leading-tight">
              {model.title}
            </span>
          </span>
          <span className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[0.625rem] font-medium leading-4',
            TONE_CLASSES[model.statusTone]
          )}>
            {model.status}
          </span>
        </header>

        {!compact && (
          <>
            <p className="mt-2 truncate text-[0.6875rem] text-muted-foreground">
              {model.deleted ? `Previously in ${model.context}` : model.context}
            </p>
            {model.preview && (
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-foreground/80">
                {model.preview}
              </p>
            )}
            <dl className={cn(
              'mt-auto grid gap-1.5 border-t border-border/70 pt-2.5',
              model.facts.length === 1 ? 'grid-cols-1' : 'grid-cols-3'
            )}>
              {model.facts.map((fact) => (
                <div key={fact.label} className="min-w-0">
                  <dt className="truncate text-[0.5625rem] font-medium uppercase tracking-wide text-muted-foreground">
                    {fact.label}
                  </dt>
                  <dd className={cn(
                    'mt-0.5 truncate text-[0.6875rem] font-medium text-foreground/85',
                    fact.tone === 'warning' && 'text-warning-foreground',
                    fact.tone === 'destructive' && 'text-destructive',
                    fact.tone === 'success' && 'text-success-foreground'
                  )}>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </article>
  )
}
