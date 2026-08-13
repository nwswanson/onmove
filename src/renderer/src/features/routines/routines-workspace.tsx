import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronRight, ListChecks } from 'lucide-react'
import type {
  AttestRoutineRunItemInput,
  RoutineReviewCellSnapshot,
  RoutineReviewRunSnapshot,
  RoutineRunItemSnapshot,
  RoutineSnapshot,
  UpdateRoutineInput
} from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import {
  ContextDrawerOutlet,
  type ContextDrawerAdapter,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import {
  ContextualSidebar,
  ContextualSidebarLevel,
  ContextualSidebarNavigation,
  type ContextualSidebarItemModel,
  useContextualSidebarNavigation
} from '@/components/ui/contextual-sidebar'
import { Input } from '@/components/ui/input'
import { StateLabel, type StateLabelModel } from '@/components/ui/state-label'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import type { FocusWorkspaceDestinationTarget } from '@/features/application/application-navigation'
import {
  RoutineEditorDialog,
  type RoutineEditorParent
} from '@/features/routines/routine-editor-dialog'
import { routineDrawerAdapter } from '@/features/routines/routine-presenters'
import {
  useRoutinesModel,
  type RoutineParentOption
} from '@/features/routines/use-routines-model'
import { cn } from '@/lib/utils'

const CONTEXTUAL_SIDEBAR_MIN = 220
const CONTEXTUAL_SIDEBAR_MAX = 340

function localDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function endOfCalendarWeek(date: string): string {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + (7 - value.getDay()) % 7)
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0')
  ].join('-')
}

function statusModel(status: RoutineSnapshot['status']): StateLabelModel {
  if (status === 'green') return { label: 'Current', tone: 'success' }
  if (status === 'yellow') return { label: 'Overdue', tone: 'warning' }
  return { label: 'Lapsed', tone: 'danger' }
}

function destinationFor(parent: RoutineParentOption): FocusWorkspaceDestinationTarget {
  return {
    focusId: parent.focusId,
    threadId: parent.thread?.id ?? null,
    commitmentId: null,
    subjectId: null
  }
}

interface RoutineQueueEntry {
  id: string
  routine: RoutineSnapshot
  run: RoutineReviewRunSnapshot | null
  cell: RoutineReviewCellSnapshot | null
  subject: { id: number; name: string } | null
  scheduledDate: string
  parent: RoutineParentOption | null
}

function cellKey(cell: RoutineReviewCellSnapshot): string {
  return cell.subject ? `subject:${cell.subject.id}` : 'unscoped'
}

function queueEntries(
  routines: readonly RoutineSnapshot[],
  parentFor: (routine: RoutineSnapshot) => RoutineParentOption | null,
  hideSensitiveContent: boolean
): RoutineQueueEntry[] {
  const entries: RoutineQueueEntry[] = []
  for (const routine of routines) {
    const parent = parentFor(routine)
    if (!routine.needsAttestation) continue
    if (
      hideSensitiveContent &&
      (routine.sensitive || parent?.focus.sensitive || parent?.thread?.sensitive)
    ) continue
    if (routine.currentRun?.completionDate === null) {
      for (const cell of routine.currentRun.cells) {
        if (cell.completionDate !== null) continue
        entries.push({
          id: `${routine.id}:${routine.currentRun.id}:${cell.id}`,
          routine,
          run: routine.currentRun,
          cell,
          subject: cell.subject,
          scheduledDate: routine.currentRun.scheduledDate,
          parent
        })
      }
    }
    if (routine.currentRun === null || routine.currentRun.completionDate !== null) {
      const upcomingSubjects = routine.scope?.subjects.length
        ? routine.scope.subjects
        : [null]
      for (const subject of upcomingSubjects) {
        const key = subject ? `subject:${subject.id}` : 'unscoped'
        entries.push({
          id: `${routine.id}:upcoming:${key}`,
          routine,
          run: null,
          cell: null,
          subject,
          scheduledDate: routine.currentRun === null
            ? routine.nextReviewDate
            : routine.nextScheduledDate,
          parent
        })
      }
    }
  }
  return entries.sort((left, right) =>
    left.scheduledDate.localeCompare(right.scheduledDate) ||
    left.routine.name.localeCompare(right.routine.name) ||
    (left.subject?.name ?? '').localeCompare(right.subject?.name ?? '')
  )
}

const GROUPS = {
  overdue: { id: 'past-due', label: 'Past due' },
  today: { id: 'today', label: 'Today' },
  week: { id: 'this-week', label: 'This week' },
  upcoming: { id: 'upcoming', label: 'Upcoming' }
} as const

function queueSidebarItems(entries: readonly RoutineQueueEntry[]): ContextualSidebarItemModel[] {
  const today = localDate()
  const weekEnd = endOfCalendarWeek(today)
  return entries.map((entry) => ({
    id: entry.id,
    label: entry.routine.name,
    ariaLabel: `${entry.routine.name} — ${entry.subject?.name ?? 'No scope'}`,
    description: [entry.subject?.name ?? 'No scope', entry.parent?.label]
      .filter(Boolean)
      .join(' · '),
    group: entry.scheduledDate < today
      ? GROUPS.overdue
      : entry.scheduledDate === today
        ? GROUPS.today
        : entry.scheduledDate <= weekEnd
          ? GROUPS.week
          : GROUPS.upcoming,
    stateLabel: statusModel(entry.routine.status),
    lines: 2
  }))
}

function RoutineRunItem({
  item,
  immutable,
  saving,
  onAttest
}: {
  item: RoutineRunItemSnapshot
  immutable: boolean
  saving: boolean
  onAttest: (itemId: number, input: AttestRoutineRunItemInput) => Promise<unknown>
}): React.JSX.Element {
  const [issueDescription, setIssueDescription] = useState(item.issue?.description ?? '')
  const [followUpType, setFollowUpType] = useState(item.issue?.followUpType ?? 'none')
  const issueFound = item.issue !== null
  const issueInput = (overrides: Partial<AttestRoutineRunItemInput> = {}): AttestRoutineRunItemInput => ({
    resolution: item.resolution,
    issueFound,
    issueDescription,
    issueFollowUpType: followUpType,
    ...overrides
  })

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <label className="flex min-w-0 flex-1 items-start gap-3 text-sm leading-6">
          <input
            type="checkbox"
            className="mt-1.5"
            aria-label={`Attest: ${item.inspection}`}
            checked={item.resolution === 'attested'}
            disabled={immutable || saving}
            onChange={(event) => void onAttest(item.id, issueInput({
              resolution: event.target.checked ? 'attested' : 'pending',
              issueFound: event.target.checked ? issueFound : false,
              issueFollowUpType: event.target.checked ? followUpType : 'none'
            }))}
          />
          <span className={cn(item.resolution !== 'pending' && 'text-muted-foreground')}>
            {item.inspection}
          </span>
        </label>
        <Button
          type="button"
          size="sm"
          variant={item.resolution === 'not_applicable' ? 'default' : 'outline'}
          disabled={immutable || saving}
          onClick={() => void onAttest(item.id, issueInput({
            resolution: item.resolution === 'not_applicable' ? 'pending' : 'not_applicable',
            issueFound: item.resolution === 'not_applicable' ? false : issueFound,
            issueFollowUpType: item.resolution === 'not_applicable' ? 'none' : followUpType
          }))}
        >
          N/A
        </Button>
      </div>
      <div className="ml-7 mt-2 rounded-lg bg-muted/45 px-3 py-2.5">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={issueFound}
            disabled={immutable || saving}
            onChange={(event) => void onAttest(item.id, issueInput({
              issueFound: event.target.checked,
              issueFollowUpType: event.target.checked ? followUpType : 'none'
            }))}
          />
          Issue found
        </label>
        {issueFound && (
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem]">
            <Input
              aria-label={`Issue found for ${item.inspection}`}
              value={issueDescription}
              disabled={immutable || saving}
              placeholder="What did the inspection reveal?"
              onChange={(event) => setIssueDescription(event.target.value)}
              onBlur={() => void onAttest(item.id, issueInput({ issueDescription }))}
            />
            <select
              aria-label="Issue follow-up"
              className="h-9 rounded-lg border border-border bg-background px-2 text-xs"
              value={followUpType}
              disabled={immutable || saving}
              onChange={(event) => {
                const value = event.target.value as AttestRoutineRunItemInput['issueFollowUpType']
                setFollowUpType(value ?? 'none')
                void onAttest(item.id, issueInput({ issueFollowUpType: value }))
              }}
            >
              <option value="none">Record only</option>
              <option value="update">Follow up with Update</option>
              <option value="commitment">Follow up with Commitment</option>
              <option value="move">Follow up with Move</option>
            </select>
          </div>
        )}
      </div>
    </div>
  )
}

function CellChecklist({
  cell,
  saving,
  onAttest
}: {
  cell: RoutineReviewCellSnapshot
  saving: boolean
  onAttest: (itemId: number, input: AttestRoutineRunItemInput) => Promise<unknown>
}): React.JSX.Element {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background/70">
      {cell.items.map((item) => (
        <RoutineRunItem
          key={item.id}
          item={item}
          immutable={cell.completionDate !== null}
          saving={saving}
          onAttest={onAttest}
        />
      ))}
    </div>
  )
}

interface RoutinesWorkspaceProps {
  contextDrawer: ContextDrawerControl
  hideSensitiveContent: boolean
  onOpenContext: (destination: FocusWorkspaceDestinationTarget) => void
}

export function RoutinesWorkspace({
  contextDrawer,
  hideSensitiveContent,
  onOpenContext
}: RoutinesWorkspaceProps): React.JSX.Element {
  const model = useRoutinesModel()
  const [sidebarWidth, setSidebarWidth] = useState(268)
  const [editor, setEditor] = useState<RoutineSnapshot | null>(null)
  const [level] = useState(() => new ContextualSidebarLevel({
    id: 'routine-attestations',
    title: 'Routines',
    ariaLabel: 'Routine attestation queue',
    items: [],
    emptyState: 'Nothing needs attestation'
  }))
  const [navigation] = useState(() => new ContextualSidebarNavigation(level))
  const navigationSnapshot = useContextualSidebarNavigation(navigation)
  const entries = useMemo(
    () => queueEntries(model.routines, model.parentFor, hideSensitiveContent),
    [hideSensitiveContent, model.parentFor, model.routines]
  )
  const sidebarItems = useMemo(() => queueSidebarItems(entries), [entries])
  const selectedEntry = entries.find(({ id }) => id === navigationSnapshot.selectedItemId) ?? null
  const selectedRoutine = selectedEntry?.routine ?? null

  useEffect(() => {
    level.setItems(sidebarItems)
    navigation.refresh()
  }, [level, navigation, sidebarItems])

  function parentEditorOption(routine: RoutineSnapshot): RoutineEditorParent | null {
    const parent = model.parentFor(routine)
    return parent ? { parent: parent.parent, label: parent.label, scope: parent.scope } : null
  }

  function adapterFor(routine: RoutineSnapshot): ContextDrawerAdapter {
    const parent = model.parentFor(routine)
    return routineDrawerAdapter({
      routine,
      parentLabel: parent?.label ?? 'Parent unavailable',
      ancestorKeys: parent
        ? [`focus:${parent.focusId}`, ...(parent.thread ? [`thread:${parent.thread.id}`] : [])]
        : [],
      onSave: async (input) => {
        const updated = await model.update(routine.id, input)
        if (!updated) throw new Error('Routine update failed')
        if (contextDrawer.pinnedAdapter?.id === `routine:${routine.id}`) {
          contextDrawer.onPin(adapterFor(updated))
        }
      },
      onEditTemplate: () => setEditor(routine),
      onDelete: async () => {
        if (!await model.remove(routine.id)) throw new Error('Routine deletion failed')
        contextDrawer.onInvalidate([`routine:${routine.id}`])
      }
    })
  }

  const priorCells = selectedEntry?.run && selectedEntry.cell
    ? [selectedEntry.routine.currentRun, ...selectedEntry.routine.previousRuns]
        .filter((run): run is RoutineReviewRunSnapshot => run !== null && run.id !== selectedEntry.run?.id)
        .map((run) => ({
          run,
          cell: run.cells.find((cell) => selectedEntry.cell && cellKey(cell) === cellKey(selectedEntry.cell)) ?? null
        }))
        .filter((entry): entry is { run: RoutineReviewRunSnapshot; cell: RoutineReviewCellSnapshot } =>
          entry.cell !== null
        )
        .sort((left, right) => right.run.scheduledDate.localeCompare(left.run.scheduledDate))
    : []

  return (
    <>
      <WorkspaceShell
        contextualSidebar={
          <ContextualSidebar navigation={navigation} style={{ width: sidebarWidth }} />
        }
        contextualSidebarResize={{
          label: 'Resize contextual sidebar',
          value: sidebarWidth,
          min: CONTEXTUAL_SIDEBAR_MIN,
          max: CONTEXTUAL_SIDEBAR_MAX,
          direction: 1,
          onChange: setSidebarWidth
        }}
        main={
          <main className="min-w-0 flex-1 overflow-auto bg-background" aria-labelledby="routines-heading">
            <section className="mx-auto w-full max-w-5xl p-8 sm:p-10">
              {model.error && (
                <p role="alert" className="mb-5 flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="size-4" aria-hidden="true" /> {model.error}
                </p>
              )}
              {model.loading ? (
                <p className="text-sm text-muted-foreground">Loading Routines…</p>
              ) : selectedEntry ? (
                <>
                  <div className="flex flex-wrap items-start gap-4 border-b border-border pb-5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-foreground">
                      <ListChecks className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h1 id="routines-heading" className="text-xl font-semibold tracking-tight">
                          {selectedEntry.routine.name}
                        </h1>
                        <StateLabel model={statusModel(selectedEntry.routine.status)} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {selectedEntry.parent && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
                            onClick={() => onOpenContext(destinationFor(selectedEntry.parent as RoutineParentOption))}
                          >
                            {selectedEntry.parent.label}<ChevronRight className="size-3" aria-hidden="true" />
                          </button>
                        )}
                        <span>{selectedEntry.subject?.name ?? 'No scope'}</span>
                        <span>{selectedEntry.run ? 'Scheduled' : 'Upcoming'} {selectedEntry.scheduledDate}</span>
                        <span>Template v{selectedEntry.run?.templateVersion ?? selectedEntry.routine.template.version}</span>
                      </div>
                    </div>
                    <span className="text-xs font-medium tabular-nums">
                      {selectedEntry.cell?.progress.complete ?? 0} of{' '}
                      {selectedEntry.cell?.progress.required ?? selectedEntry.routine.template.items.filter(({ required }) => required).length} attested
                    </span>
                  </div>

                  <section className="mt-6" aria-labelledby="current-checklist-heading">
                    <h2 id="current-checklist-heading" className="mb-2 text-sm font-semibold">
                      Current immutable checklist
                    </h2>
                    {selectedEntry.cell ? (
                      <CellChecklist
                        cell={selectedEntry.cell}
                        saving={model.saving}
                        onAttest={model.attest}
                      />
                    ) : (
                      <div className="overflow-hidden rounded-xl border border-border bg-background/70">
                        <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                          This checklist becomes an immutable Run on {selectedEntry.scheduledDate}.
                        </p>
                        <ol className="divide-y divide-border">
                          {selectedEntry.routine.template.items.map((item) => (
                            <li key={item.id} className="flex items-start gap-3 px-4 py-3 text-sm text-muted-foreground">
                              <span className="mt-0.5 size-4 rounded border border-border" aria-hidden="true" />
                              <span>{item.inspection}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </section>

                  {priorCells.length > 0 && (
                    <details className="mt-6 rounded-xl border border-border bg-muted/20">
                      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                        Previous Runs <span className="ml-1 text-xs text-muted-foreground">({priorCells.length})</span>
                      </summary>
                      <div className="divide-y divide-border border-t border-border">
                        {priorCells.map(({ run, cell }) => (
                          <details key={`${run.id}:${cell.id}`} className="px-4 py-3">
                            <summary className="cursor-pointer text-xs font-medium">
                              Scheduled {run.scheduledDate} · {cell.completionDate
                                ? `completed ${cell.completionDate}${cell.completedLate ? ' (late)' : ''}`
                                : 'incomplete'} · Template v{run.templateVersion}
                            </summary>
                            <div className="mt-3">
                              <CellChecklist cell={cell} saving={model.saving} onAttest={model.attest} />
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
                  <Check className="mx-auto size-6 text-success" aria-hidden="true" />
                  <h1 id="routines-heading" className="mt-3 text-base font-semibold">All caught up</h1>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add Routines from a Focus or Thread. Subject attestations appear here one at a time.
                  </p>
                </div>
              )}
            </section>
          </main>
        }
        drawer={
          <ContextDrawerOutlet
            adapter={selectedRoutine ? adapterFor(selectedRoutine) : null}
            {...contextDrawer}
          />
        }
      />

      {editor && parentEditorOption(editor) && (
        <RoutineEditorDialog
          parent={parentEditorOption(editor) as RoutineEditorParent}
          routine={editor}
          saving={model.saving}
          onClose={() => setEditor(null)}
          onSave={async (input) => {
            const updated = await model.update(editor.id, input as UpdateRoutineInput)
            if (updated) setEditor(null)
            return updated !== null
          }}
        />
      )}
    </>
  )
}
