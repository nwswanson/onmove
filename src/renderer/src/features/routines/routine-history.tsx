import { AlertTriangle, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StateLabel, type StateLabelModel } from '@/components/ui/state-label'
import { TaggedText } from '@/components/ui/tagged-text'
import {
  RoutineCellChecklist,
  type RoutineCellChecklistModel,
  type RoutineCellItemMutation
} from '@/features/routines/routine-cell-checklist'

export interface RoutineHistoryCellModel {
  id: string
  subjectLabel: string
  progressLabel: string
  completionLabel: string
  checklist: RoutineCellChecklistModel
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
  scheduleLabel: string
  scopeLabel: string
  nextReviewLabel: string
  needsAttestationLabel: string
  currentCheckIn: RoutineCheckInModel | null
  checkIns: readonly RoutineCheckInModel[]
}

function RoutineCheckInContents({
  checkIn,
  onMutateItem,
  onFinalizeCell
}: {
  checkIn: RoutineCheckInModel
  onMutateItem: (itemId: number, input: RoutineCellItemMutation) => unknown | Promise<unknown>
  onFinalizeCell: (cellId: number) => unknown | Promise<unknown>
}): React.JSX.Element {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
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
      <div className="divide-y divide-border/60 border-t border-border/70">
        {checkIn.cells.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">
            No Subject check-in is available in this context.
          </p>
        ) : checkIn.cells.map((cell) => (
          <section key={cell.id} className="py-4">
            <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <h3 className="font-semibold">{cell.subjectLabel}</h3>
              <span className="text-muted-foreground">{cell.completionLabel}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{cell.progressLabel}</span>
            </header>
            <RoutineCellChecklist
              cell={cell.checklist}
              onMutateItem={onMutateItem}
              onFinalize={onFinalizeCell}
            />
          </section>
        ))}
      </div>
    </>
  )
}

export function RoutineHistory({
  model,
  onEdit,
  onMutateItem,
  onFinalizeCell
}: {
  model: RoutineHistoryModel
  onEdit: () => void
  onMutateItem: (itemId: number, input: RoutineCellItemMutation) => unknown | Promise<unknown>
  onFinalizeCell: (cellId: number) => unknown | Promise<unknown>
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
              <span>{model.scheduleLabel}</span>
              <span>{model.scopeLabel}</span>
              <span>{model.nextReviewLabel}</span>
              <span>{model.needsAttestationLabel}</span>
            </div>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={onEdit}>Edit</Button>
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Current check-in</h2>
        {model.currentCheckIn ? (
          <div className="border-y border-border/70">
            <RoutineCheckInContents
              checkIn={model.currentCheckIn}
              onMutateItem={onMutateItem}
              onFinalizeCell={onFinalizeCell}
            />
          </div>
        ) : (
          <p className="border-y border-border/70 py-5 text-sm text-muted-foreground">
            No check-in is currently scheduled.
          </p>
        )}
      </div>

      <div className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">Check-in history</h2>
        {model.checkIns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No previous check-ins.
          </div>
        ) : (
          <div className="divide-y divide-border/70 border-y border-border/70">
            {model.checkIns.map((checkIn, index) => (
              <details
                key={checkIn.id}
                className="group"
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
                <div className="border-t border-border/70 px-4">
                  <RoutineCheckInContents
                    checkIn={checkIn}
                    onMutateItem={onMutateItem}
                    onFinalizeCell={onFinalizeCell}
                  />
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
