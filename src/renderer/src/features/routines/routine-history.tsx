import { AlertTriangle, Check, ListChecks, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StateLabel, type StateLabelModel } from '@/components/ui/state-label'
import { TaggedText } from '@/components/ui/tagged-text'

export interface RoutineHistoryItemModel {
  id: string
  inspection: string
  resolutionLabel: string
  resolutionTone: 'success' | 'neutral'
  attestedLabel: string | null
  issue: { description: string; followUpLabel: string } | null
}

export interface RoutineHistoryCellModel {
  id: string
  subjectLabel: string
  progressLabel: string
  completionLabel: string
  items: readonly RoutineHistoryItemModel[]
}

export interface RoutineCheckInModel {
  id: string
  scheduledLabel: string
  completionLabel: string
  progressLabel: string
  templateLabel: string
  late: boolean
  cells: readonly RoutineHistoryCellModel[]
}

export interface RoutineHistoryModel {
  name: string
  stateLabel: StateLabelModel
  cadenceLabel: string
  scopeLabel: string
  nextReviewLabel: string
  needsAttestationLabel: string
  checkIns: readonly RoutineCheckInModel[]
}

export function RoutineHistory({
  model,
  onEdit
}: {
  model: RoutineHistoryModel
  onEdit: () => void
}): React.JSX.Element {
  return (
    <section
      className="mx-auto w-full max-w-5xl p-8 sm:p-10"
      aria-labelledby="routine-history-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/20">
            <ListChecks className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Routine
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 id="routine-history-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                <TaggedText value={model.name} />
              </h1>
              <StateLabel model={model.stateLabel} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{model.cadenceLabel}</span>
              <span>{model.scopeLabel}</span>
              <span>{model.nextReviewLabel}</span>
              <span>{model.needsAttestationLabel}</span>
            </div>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={onEdit}>Edit</Button>
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Check-in history</h2>
        {model.checkIns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No check-ins yet.
          </div>
        ) : (
          <div className="space-y-3">
            {model.checkIns.map((checkIn, index) => (
              <details
                key={checkIn.id}
                className="overflow-hidden rounded-xl border border-border bg-card/45"
                open={index === 0}
              >
                <summary className="cursor-pointer list-none px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/45">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold">{checkIn.scheduledLabel}</span>
                    <span className="text-xs text-muted-foreground">{checkIn.completionLabel}</span>
                    {checkIn.late && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                        <AlertTriangle className="size-3.5" aria-hidden="true" /> Late
                      </span>
                    )}
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {checkIn.progressLabel} · {checkIn.templateLabel}
                    </span>
                  </div>
                </summary>
                <div className="space-y-3 border-t border-border bg-background/55 p-3">
                  {checkIn.cells.map((cell) => (
                    <section key={cell.id} className="overflow-hidden rounded-lg border border-border/75 bg-background/70">
                      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 bg-muted/25 px-3 py-2 text-xs">
                        <h3 className="font-semibold">{cell.subjectLabel}</h3>
                        <span className="text-muted-foreground">{cell.completionLabel}</span>
                        <span className="ml-auto tabular-nums text-muted-foreground">{cell.progressLabel}</span>
                      </header>
                      <ul className="divide-y divide-border/65" aria-label={`${cell.subjectLabel} attestations`}>
                        {cell.items.map((item) => (
                          <li key={item.id} className="px-3 py-2.5">
                            <div className="flex items-start gap-2.5 text-sm">
                              {item.resolutionTone === 'success' ? (
                                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                              ) : (
                                <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              )}
                              <span className="min-w-0 flex-1"><TaggedText value={item.inspection} /></span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {item.resolutionLabel}
                              </span>
                            </div>
                            {item.attestedLabel && (
                              <p className="mt-1 pl-6 text-xs text-muted-foreground">{item.attestedLabel}</p>
                            )}
                            {item.issue && (
                              <div className="mt-2 ml-6 rounded-md border border-destructive/25 bg-destructive/8 px-2.5 py-2 text-xs">
                                <p className="font-medium text-destructive">Issue found</p>
                                <p className="mt-0.5 text-foreground"><TaggedText value={item.issue.description} /></p>
                                <p className="mt-1 text-muted-foreground">{item.issue.followUpLabel}</p>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
