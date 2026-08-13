import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type {
  CommitmentParent,
  CreateRoutineInput,
  RoutineSnapshot,
  RoutineTemplateItemInput,
  UpdateRoutineInput
} from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { TaggedText } from '@/components/ui/tagged-text'

function localDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface RoutineEditorParent {
  parent: CommitmentParent
  label: string
  scope: { id: number; name: string } | null
}

interface FormItem {
  key: number
  inspection: string
  required: boolean
}

let formItemKey = 0

function initialItems(routine?: RoutineSnapshot): FormItem[] {
  return (routine?.template.items ?? [
    { inspection: 'Verify delivery risks are represented in the weekly update.', required: true },
    { inspection: 'Confirm scope changes received approval.', required: true }
  ]).map((item) => ({
    key: ++formItemKey,
    inspection: item.inspection,
    required: item.required
  }))
}

export function RoutineEditor({
  parent,
  routine,
  saving,
  embedded = false,
  onCancel,
  onSave
}: {
  parent: RoutineEditorParent
  routine?: RoutineSnapshot
  saving: boolean
  embedded?: boolean
  onCancel: () => void
  onSave: (input: CreateRoutineInput | UpdateRoutineInput) => Promise<boolean>
}): React.JSX.Element {
  const [name, setName] = useState(routine?.name ?? '')
  const [cadenceDays, setCadenceDays] = useState(String(routine?.cadenceDays ?? 7))
  const [anchorDate, setAnchorDate] = useState(routine?.anchorDate ?? localDate())
  const [useScope, setUseScope] = useState(routine?.scope !== null && routine?.scope !== undefined)
  const [sensitive, setSensitive] = useState(routine?.sensitive ?? false)
  const [needsAttestation, setNeedsAttestation] = useState(routine?.needsAttestation ?? true)
  const [items, setItems] = useState<FormItem[]>(() => initialItems(routine))
  const [error, setError] = useState<string | null>(null)
  const fieldSuffix = routine ? `edit-${routine.id}` : 'new'
  const valid = name.trim().length > 0 && Number(cadenceDays) > 0 &&
    anchorDate.length === 10 && items.some(
      ({ inspection, required }) => inspection.trim().length > 0 && required
    )

  async function save(): Promise<void> {
    if (!valid) return
    const checklist: RoutineTemplateItemInput[] = items
      .filter(({ inspection }) => inspection.trim().length > 0)
      .map(({ inspection, required }) => ({ inspection, required }))
    const common = {
      name,
      cadenceDays: Number(cadenceDays),
      anchorDate,
      scopeId: useScope ? parent.scope?.id ?? null : null,
      sensitive,
      needsAttestation,
      checklist
    }
    setError(null)
    const saved = await onSave(routine ? common : { ...common, parent: parent.parent })
    if (saved) onCancel()
    else setError(`The Routine could not be ${routine ? 'updated' : 'added'}.`)
  }

  const fields = (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <label className="text-xs font-medium" htmlFor={`routine-name-${fieldSuffix}`}>
            Routine name
          </label>
          <Input
            id={`routine-name-${fieldSuffix}`}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium" htmlFor={`routine-cadence-${fieldSuffix}`}>
            Check every
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={`routine-cadence-${fieldSuffix}`}
              type="number"
              min={1}
              step={1}
              value={cadenceDays}
              onChange={(event) => setCadenceDays(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">days</span>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium" htmlFor={`routine-anchor-${fieldSuffix}`}>
            Schedule anchor
          </label>
          <Input
            id={`routine-anchor-${fieldSuffix}`}
            type="date"
            value={anchorDate}
            onChange={(event) => setAnchorDate(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className={`flex items-center gap-2 ${parent.scope ? '' : 'text-muted-foreground'}`}>
          <input
            type="checkbox"
            checked={useScope}
            disabled={!parent.scope}
            onChange={(event) => setUseScope(event.target.checked)}
          />
          Apply {parent.scope?.name ?? 'optional scope'}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={sensitive}
            onChange={(event) => setSensitive(event.target.checked)}
          />
          Sensitive
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={needsAttestation}
            onChange={(event) => setNeedsAttestation(event.target.checked)}
          />
          Needs attestation
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Inspection checklist</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Phrase entries as inspections, not outcomes.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setItems((current) => [...current, {
              key: ++formItemKey,
              inspection: '',
              required: true
            }])}
          >
            <Plus aria-hidden="true" /> Add inspection
          </Button>
        </div>
        <div className="divide-y divide-border border-y border-border/70">
          {items.map((item, index) => (
            <div key={item.key} className="flex items-start gap-2 py-2.5">
              <span className="mt-2 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <Input
                aria-label={`Inspection ${index + 1}`}
                placeholder="Verify…"
                value={item.inspection}
                onChange={(event) => setItems((current) => current.map((candidate) =>
                  candidate.key === item.key
                    ? { ...candidate, inspection: event.target.value }
                    : candidate
                ))}
              />
              <label className="mt-2 flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={item.required}
                  onChange={(event) => setItems((current) => current.map((candidate) =>
                    candidate.key === item.key
                      ? { ...candidate, required: event.target.checked }
                      : candidate
                  ))}
                />
                Required
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={`Remove inspection ${index + 1}`}
                disabled={items.length === 1}
                onClick={() => setItems((current) =>
                  current.filter(({ key }) => key !== item.key))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <footer className="flex items-center justify-end gap-2 border-t border-border/70 pt-4">
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={!valid || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : routine ? 'Save Routine' : 'Add Routine'}
        </Button>
      </footer>
    </>
  )

  if (!embedded) return <div className="space-y-5">{fields}</div>

  return (
    <section
      className="mx-auto w-full max-w-5xl p-8 sm:p-10"
      aria-labelledby="routine-editor-heading"
    >
      <header className="border-b border-border/70 pb-5">
        <p className="mb-1 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Edit Routine
        </p>
        <h1 id="routine-editor-heading" className="text-2xl font-semibold tracking-[-0.025em]">
          <TaggedText value={name || routine?.name || 'Routine'} />
        </h1>
        <p className="mt-2 text-xs text-muted-foreground">
          {parent.label} · Changes apply only to future Runs.
        </p>
      </header>
      <div className="mt-6 space-y-5">{fields}</div>
    </section>
  )
}

export function RoutineEditorDialog({
  parent,
  saving,
  onClose,
  onSave
}: {
  parent: RoutineEditorParent
  saving: boolean
  onClose: () => void
  onSave: (input: CreateRoutineInput) => Promise<boolean>
}): React.JSX.Element {
  return (
    <Dialog
      open
      title="Add Routine"
      description={`${parent.label} · Each scheduled Run preserves this checklist as an immutable snapshot.`}
      contentClassName="max-w-2xl"
      onClose={onClose}
    >
      <div className="max-h-[65vh] overflow-auto pr-1">
        <RoutineEditor
          parent={parent}
          saving={saving}
          onCancel={onClose}
          onSave={(input) => onSave(input as CreateRoutineInput)}
        />
      </div>
    </Dialog>
  )
}
