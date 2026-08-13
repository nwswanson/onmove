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
import { Dialog, DialogField } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

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

export function RoutineEditorDialog({
  parent,
  routine,
  saving,
  onClose,
  onSave,
  onDelete
}: {
  parent: RoutineEditorParent
  routine?: RoutineSnapshot
  saving: boolean
  onClose: () => void
  onSave: (input: CreateRoutineInput | UpdateRoutineInput) => Promise<boolean>
  onDelete?: () => Promise<boolean>
}): React.JSX.Element {
  const [name, setName] = useState(routine?.name ?? '')
  const [cadenceDays, setCadenceDays] = useState(String(routine?.cadenceDays ?? 7))
  const [anchorDate, setAnchorDate] = useState(routine?.anchorDate ?? localDate())
  const [useScope, setUseScope] = useState(routine?.scope !== null && routine?.scope !== undefined)
  const [sensitive, setSensitive] = useState(routine?.sensitive ?? false)
  const [needsAttestation, setNeedsAttestation] = useState(routine?.needsAttestation ?? true)
  const [items, setItems] = useState<FormItem[]>(() => initialItems(routine))
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
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
    if (saved) onClose()
    else setError(`The Routine could not be ${routine ? 'updated' : 'added'}.`)
  }

  return (
    <>
      <Dialog
      open
      title={routine ? 'Edit Routine' : 'Add Routine'}
      description={`${parent.label} · Each scheduled Run preserves this checklist as an immutable snapshot.`}
      contentClassName="max-w-2xl"
      onClose={onClose}
      footer={
        <>
          {routine && onDelete && (
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              disabled={saving}
              onClick={() => setConfirmDelete(true)}
            >
              Delete Routine
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!valid || saving} onClick={() => void save()}>
            {routine ? 'Save Routine' : 'Add Routine'}
          </Button>
        </>
      }
    >
      <div className="max-h-[65vh] space-y-5 overflow-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <DialogField className="sm:col-span-2">
            <label className="text-xs font-medium" htmlFor="routine-name">Routine name</label>
            <Input id="routine-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </DialogField>
          <DialogField>
            <label className="text-xs font-medium" htmlFor="routine-cadence">Check every</label>
            <div className="flex items-center gap-2">
              <Input
                id="routine-cadence"
                type="number"
                min={1}
                step={1}
                value={cadenceDays}
                onChange={(event) => setCadenceDays(event.target.value)}
              />
              <span className="text-xs text-muted-foreground">days</span>
            </div>
          </DialogField>
          <DialogField>
            <label className="text-xs font-medium" htmlFor="routine-anchor">Schedule anchor</label>
            <Input id="routine-anchor" type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
          </DialogField>
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
            <input type="checkbox" checked={sensitive} onChange={(event) => setSensitive(event.target.checked)} />
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
              <h3 className="text-sm font-semibold">Inspection checklist</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Phrase entries as inspections, not outcomes.</p>
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
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background/65">
            {items.map((item, index) => (
              <div key={item.key} className="flex items-start gap-2 px-3 py-2.5">
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
                  onClick={() => setItems((current) => current.filter(({ key }) => key !== item.key))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
      </Dialog>
      <Dialog
        open={confirmDelete}
        title="Delete Routine?"
        description={`“${routine?.name ?? ''}” and every immutable Run will be permanently deleted.`}
        onClose={() => !saving && setConfirmDelete(false)}
        footer={
          <>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={saving}
              onClick={() => void (async () => {
                if (!onDelete) return
                setError(null)
                if (await onDelete()) onClose()
                else {
                  setConfirmDelete(false)
                  setError('The Routine could not be deleted.')
                }
              })()}
            >
              Delete Routine
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
      </Dialog>
    </>
  )
}
