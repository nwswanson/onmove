import { useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import type {
  AttestRoutineRunItemInput,
  CreateRoutineInput,
  RoutineReviewRunSnapshot,
  RoutineRunItemSnapshot,
  RoutineSnapshot,
  RoutineTemplateItemInput,
  UpdateRoutineInput
} from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { StateLabel, type StateLabelModel } from '@/components/ui/state-label'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import type { FocusWorkspaceDestinationTarget } from '@/features/application/application-navigation'
import {
  useRoutinesModel,
  type RoutineParentOption
} from '@/features/routines/use-routines-model'
import { cn } from '@/lib/utils'

interface RoutinesWorkspaceProps {
  contextDrawer: ContextDrawerControl
  hideSensitiveContent: boolean
  onOpenContext: (destination: FocusWorkspaceDestinationTarget) => void
}

function localDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function statusModel(status: RoutineSnapshot['status']): StateLabelModel {
  if (status === 'green') return { label: 'Current', tone: 'success' }
  if (status === 'yellow') return { label: 'Overdue', tone: 'warning' }
  return { label: 'Lapsed', tone: 'danger' }
}

function dueLabel(routine: RoutineSnapshot): string {
  if (routine.overdueDays > 0) {
    return `${routine.overdueDays} ${routine.overdueDays === 1 ? 'day' : 'days'} overdue`
  }
  if (routine.nextReviewDate === localDate()) return 'Review today'
  return `Next review ${routine.nextReviewDate}`
}

function destinationFor(parent: RoutineParentOption): FocusWorkspaceDestinationTarget {
  return {
    focusId: parent.focusId,
    threadId: parent.thread?.id ?? null,
    commitmentId: null,
    subjectId: null
  }
}

interface RoutineFormValue {
  name: string
  parentKey: string
  cadenceDays: string
  anchorDate: string
  useScope: boolean
  sensitive: boolean
  checklist: Array<{ key: number; inspection: string; required: boolean }>
}

let formItemKey = 0

function initialForm(
  parents: readonly RoutineParentOption[],
  routine?: RoutineSnapshot
): RoutineFormValue {
  return {
    name: routine?.name ?? '',
    parentKey: routine ? `${routine.parent.type}:${routine.parent.id}` : (parents[0]?.key ?? ''),
    cadenceDays: String(routine?.cadenceDays ?? 7),
    anchorDate: routine?.anchorDate ?? localDate(),
    useScope: routine?.scope !== null && routine?.scope !== undefined,
    sensitive: routine?.sensitive ?? false,
    checklist: (routine?.template.items ?? [
      { inspection: 'Verify delivery risks are represented in the weekly update.', required: true },
      { inspection: 'Confirm scope changes received approval.', required: true }
    ]).map((item) => ({
      key: ++formItemKey,
      inspection: item.inspection,
      required: item.required
    }))
  }
}

function RoutineEditorDialog({
  open,
  parents,
  routine,
  saving,
  onClose,
  onSave
}: {
  open: boolean
  parents: readonly RoutineParentOption[]
  routine?: RoutineSnapshot
  saving: boolean
  onClose: () => void
  onSave: (input: CreateRoutineInput | UpdateRoutineInput) => Promise<boolean>
}): React.JSX.Element {
  const [form, setForm] = useState(() => initialForm(parents, routine))

  const parent = parents.find(({ key }) => key === form.parentKey) ?? null
  const valid = form.name.trim().length > 0 && Number(form.cadenceDays) > 0 &&
    form.anchorDate.length === 10 && form.checklist.some(
      ({ inspection, required }) => inspection.trim().length > 0 && required
    )

  async function save(): Promise<void> {
    if (!valid || !parent) return
    const checklist: RoutineTemplateItemInput[] = form.checklist
      .filter(({ inspection }) => inspection.trim().length > 0)
      .map(({ inspection, required }) => ({ inspection, required }))
    const common = {
      name: form.name,
      cadenceDays: Number(form.cadenceDays),
      anchorDate: form.anchorDate,
      scopeId: form.useScope ? parent.scope?.id ?? null : null,
      sensitive: form.sensitive,
      checklist
    }
    const saved = await onSave(routine
      ? common
      : { ...common, parent: parent.parent })
    if (saved) onClose()
  }

  return (
    <Dialog
      open={open}
      title={routine ? 'Edit Routine' : 'New Routine'}
      description="The checklist is snapshotted into each scheduled Run. Template edits affect future Runs only."
      contentClassName="max-w-2xl"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!valid || saving || !parent} onClick={() => void save()}>
            {routine ? 'Save future template' : 'Create Routine'}
          </Button>
        </>
      }
    >
      <div className="max-h-[65vh] space-y-5 overflow-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <DialogField className="sm:col-span-2">
            <label className="text-xs font-medium" htmlFor="routine-name">Routine name</label>
            <Input
              id="routine-name"
              autoFocus
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </DialogField>
          {!routine && (
            <DialogField className="sm:col-span-2">
              <label className="text-xs font-medium" htmlFor="routine-parent">Focus or Thread</label>
              <select
                id="routine-parent"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                value={form.parentKey}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  parentKey: event.target.value,
                  useScope: false
                }))}
              >
                {parents.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </DialogField>
          )}
          <DialogField>
            <label className="text-xs font-medium" htmlFor="routine-cadence">Review every</label>
            <div className="flex items-center gap-2">
              <Input
                id="routine-cadence"
                type="number"
                min={1}
                step={1}
                value={form.cadenceDays}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  cadenceDays: event.target.value
                }))}
              />
              <span className="text-xs text-muted-foreground">days</span>
            </div>
          </DialogField>
          <DialogField>
            <label className="text-xs font-medium" htmlFor="routine-anchor">Schedule anchor</label>
            <Input
              id="routine-anchor"
              type="date"
              value={form.anchorDate}
              onChange={(event) => setForm((current) => ({
                ...current,
                anchorDate: event.target.value
              }))}
            />
          </DialogField>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className={cn('flex items-center gap-2', !parent?.scope && 'text-muted-foreground')}>
            <input
              type="checkbox"
              checked={form.useScope}
              disabled={!parent?.scope}
              onChange={(event) => setForm((current) => ({
                ...current,
                useScope: event.target.checked
              }))}
            />
            Apply {parent?.scope?.name ?? 'optional scope'}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.sensitive}
              onChange={(event) => setForm((current) => ({
                ...current,
                sensitive: event.target.checked
              }))}
            />
            Sensitive
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Inspection checklist</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Phrase entries as checks to perform, not outcomes to promise.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setForm((current) => ({
                ...current,
                checklist: [...current.checklist, {
                  key: ++formItemKey,
                  inspection: '',
                  required: true
                }]
              }))}
            >
              <Plus aria-hidden="true" /> Add inspection
            </Button>
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background/65">
            {form.checklist.map((item, index) => (
              <div key={item.key} className="flex items-start gap-2 px-3 py-2.5">
                <span className="mt-2 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <Input
                  aria-label={`Inspection ${index + 1}`}
                  placeholder="Verify…"
                  value={item.inspection}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    checklist: current.checklist.map((candidate) => candidate.key === item.key
                      ? { ...candidate, inspection: event.target.value }
                      : candidate)
                  }))}
                />
                <label className="mt-2 flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={item.required}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      checklist: current.checklist.map((candidate) => candidate.key === item.key
                        ? { ...candidate, required: event.target.checked }
                        : candidate)
                    }))}
                  />
                  Required
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label={`Remove inspection ${index + 1}`}
                  disabled={form.checklist.length === 1}
                  onClick={() => setForm((current) => ({
                    ...current,
                    checklist: current.checklist.filter((candidate) => candidate.key !== item.key)
                  }))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
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
  onAttest: (itemId: number, input: AttestRoutineRunItemInput) => Promise<boolean>
}): React.JSX.Element {
  const [issueDescription, setIssueDescription] = useState(item.issue?.description ?? '')
  const [followUpType, setFollowUpType] = useState(item.issue?.followUpType ?? 'none')

  const resolved = item.resolution !== 'pending'
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
          <span className={cn(resolved && 'text-muted-foreground')}>{item.inspection}</span>
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

function RunChecklist({
  run,
  saving,
  onAttest
}: {
  run: RoutineReviewRunSnapshot
  saving: boolean
  onAttest: (itemId: number, input: AttestRoutineRunItemInput) => Promise<boolean>
}): React.JSX.Element {
  const immutable = run.completionDate !== null
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background/70">
      {run.items.map((item) => (
        <RoutineRunItem
          key={item.id}
          item={item}
          immutable={immutable}
          saving={saving}
          onAttest={onAttest}
        />
      ))}
    </div>
  )
}

function RoutineCard({
  routine,
  parent,
  saving,
  onOpenContext,
  onEdit,
  onDelete,
  onAttest
}: {
  routine: RoutineSnapshot
  parent: RoutineParentOption | null
  saving: boolean
  onOpenContext: (parent: RoutineParentOption) => void
  onEdit: () => void
  onDelete: () => void
  onAttest: (itemId: number, input: AttestRoutineRunItemInput) => Promise<boolean>
}): React.JSX.Element {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <div className="flex flex-wrap items-start gap-3 border-b border-border/70 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-base font-semibold tracking-tight">{routine.name}</h2>
            <StateLabel model={statusModel(routine.status)} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {parent ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
                onClick={() => onOpenContext(parent)}
              >
                {parent.label}<ChevronRight className="size-3" aria-hidden="true" />
              </button>
            ) : <span>Parent unavailable</span>}
            <span>{dueLabel(routine)}</span>
            <span>Every {routine.cadenceDays} days</span>
            {routine.scope && <span>Scope: {routine.scope.name}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${routine.name}`} onClick={onEdit}>
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            aria-label={`Delete ${routine.name}`}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {routine.currentRun ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Current Run</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Scheduled {routine.currentRun.scheduledDate} · Template v{routine.currentRun.templateVersion}
                </p>
              </div>
              <span className="text-xs font-medium tabular-nums">
                {routine.currentRun.progress.complete} of {routine.currentRun.progress.required} attested
              </span>
            </div>
            <RunChecklist run={routine.currentRun} saving={saving} onAttest={onAttest} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            The first immutable Run will be created on {routine.nextReviewDate}.
          </p>
        )}

        {routine.previousRuns.length > 0 && (
          <details className="group rounded-xl border border-border bg-muted/20">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              Previous Runs <span className="ml-1 text-xs text-muted-foreground">({routine.previousRuns.length})</span>
            </summary>
            <div className="divide-y divide-border border-t border-border">
              {routine.previousRuns.map((run) => (
                <details key={run.id} className="px-4 py-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    Scheduled {run.scheduledDate} · {run.completionDate
                      ? `completed ${run.completionDate}${run.completedLate ? ' (late)' : ''}`
                      : 'incomplete'} · Template v{run.templateVersion}
                  </summary>
                  <div className="mt-3">
                    <RunChecklist run={run} saving={saving} onAttest={onAttest} />
                  </div>
                </details>
              ))}
            </div>
          </details>
        )}
      </div>
    </article>
  )
}

export function RoutinesWorkspace({
  contextDrawer,
  hideSensitiveContent,
  onOpenContext
}: RoutinesWorkspaceProps): React.JSX.Element {
  const model = useRoutinesModel()
  const [editor, setEditor] = useState<{ routine?: RoutineSnapshot } | null>(null)
  const [deleting, setDeleting] = useState<RoutineSnapshot | null>(null)
  const visible = model.routines.filter((routine) => {
    const parent = model.parentFor(routine)
    if (!hideSensitiveContent) return true
    return !routine.sensitive && !parent?.focus.sensitive && !parent?.thread?.sensitive
  })

  return (
    <>
      <WorkspaceShell
        main={
          <main className="min-w-0 flex-1 overflow-auto bg-background" aria-labelledby="routines-heading">
            <section className="mx-auto w-full max-w-5xl p-8 sm:p-10">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 id="routines-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                    Routines
                  </h1>
                  <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                    Recurring inspection checklists with immutable attestation history.
                  </p>
                </div>
                <Button
                  type="button"
                  disabled={model.parents.length === 0}
                  onClick={() => setEditor({})}
                >
                  <Plus aria-hidden="true" /> New Routine
                </Button>
              </div>

              {model.error && (
                <p role="alert" className="mt-5 flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="size-4" aria-hidden="true" /> {model.error}
                </p>
              )}
              {model.loading ? (
                <p className="mt-8 text-sm text-muted-foreground">Loading Routines…</p>
              ) : visible.length === 0 ? (
                <div className="mt-8 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
                  <Check className="mx-auto size-6 text-success" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium">No Routines yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create a reusable inspection checklist for a Focus or Thread.
                  </p>
                </div>
              ) : (
                <div className="mt-7 space-y-5">
                  {visible.map((routine) => (
                    <RoutineCard
                      key={routine.id}
                      routine={routine}
                      parent={model.parentFor(routine)}
                      saving={model.saving}
                      onOpenContext={(parent) => onOpenContext(destinationFor(parent))}
                      onEdit={() => setEditor({ routine })}
                      onDelete={() => setDeleting(routine)}
                      onAttest={model.attest}
                    />
                  ))}
                </div>
              )}
            </section>
          </main>
        }
        drawer={<ContextDrawerOutlet {...contextDrawer} />}
      />

      {editor && (
        <RoutineEditorDialog
          open
          parents={model.parents}
          routine={editor.routine}
          saving={model.saving}
          onClose={() => setEditor(null)}
          onSave={(input) => editor.routine
            ? model.update(editor.routine.id, input as UpdateRoutineInput)
            : model.create(input as CreateRoutineInput)}
        />
      )}

      <Dialog
        open={deleting !== null}
        title="Delete Routine?"
        description="The template and every attestation Run will be permanently removed."
        onClose={() => !model.saving && setDeleting(null)}
        footer={
          <>
            <Button type="button" variant="ghost" disabled={model.saving} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={model.saving}
              onClick={() => void (async () => {
                if (deleting && await model.remove(deleting.id)) setDeleting(null)
              })()}
            >
              Delete Routine
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{deleting?.name}</p>
      </Dialog>
    </>
  )
}
