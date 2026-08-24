import { ChevronRight, ListChecks } from 'lucide-react'
import { StateLabel, type StateLabelModel } from '@/components/ui/state-label'
import { TaggedText } from '@/components/ui/tagged-text'

export interface RoutineManagementItemModel {
  id: number
  name: string
  scheduleLabel: string
  scopeLabel: string
  detailLabels: readonly string[]
  stateLabel: StateLabelModel
}

export interface RoutineManagementListModel {
  items: readonly RoutineManagementItemModel[]
}

export function RoutineManagementList({
  idPrefix,
  model,
  onOpen
}: {
  idPrefix: string
  model: RoutineManagementListModel
  onOpen: (routineId: number) => void
}): React.JSX.Element {
  return (
    <section className="mt-5" aria-labelledby={`${idPrefix}-routines-heading`}>
      <h2 id={`${idPrefix}-routines-heading`} className="mb-2 text-sm font-semibold">
        Routines
      </h2>
      <div
        role="list"
        aria-label="Routines"
        className="overflow-hidden rounded-xl border border-border/80 bg-card/45"
      >
        {model.items.map((item) => (
          <div key={item.id} role="listitem" className="border-b border-border/65 last:border-b-0">
            <button
              type="button"
              aria-label={`Open Routine ${item.name}`}
              className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
              onClick={() => onOpen(item.id)}
            >
              <ListChecks className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium"><TaggedText value={item.name} /></span>
                <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{item.scheduleLabel}</span>
                  <span>{item.scopeLabel}</span>
                  {item.detailLabels.map((label) => <span key={label}>{label}</span>)}
                </span>
              </span>
              <StateLabel model={item.stateLabel} size="compact" />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </div>
        ))}
        {model.items.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No Routines for this context
          </p>
        )}
      </div>
    </section>
  )
}
