import { useRef, useState } from 'react'
import { Plus, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { StateLabel } from '@/components/ui/state-label'
import {
  validateUpdateTableModel,
  type UpdateTableDraft,
  type UpdateTableProps,
  type UpdateTableRowModel,
  type UpdateTableStateOptionModel
} from '@/features/updates/update-table-contract'
import { useThrottledAutosave } from '@/lib/use-throttled-autosave'

function updateDraftsEqual(left: UpdateTableDraft, right: UpdateTableDraft): boolean {
  return (
    left.date === right.date &&
    left.observation === right.observation &&
    left.state === right.state
  )
}

function UpdateEditorRow({
  row,
  stateOptions,
  creating = false,
  onSave,
  onDelete,
  onCancel
}: {
  row: UpdateTableRowModel
  stateOptions: readonly UpdateTableStateOptionModel[]
  creating?: boolean
  onSave: (draft: UpdateTableDraft) => Promise<void>
  onDelete?: () => Promise<void>
  onCancel?: () => void
}): React.JSX.Element {
  const initialDraft: UpdateTableDraft = {
    date: row.date,
    observation: row.observation,
    state: row.state
  }
  const [draft, setDraft] = useState<UpdateTableDraft>(initialDraft)
  const draftRef = useRef(initialDraft)
  const [creatingSave, setCreatingSave] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autosave = useThrottledAutosave({
    initialValue: initialDraft,
    isEqual: updateDraftsEqual,
    onSave
  })
  const saving = creating ? creatingSave : autosave.saving

  const selectedState =
    stateOptions.find((option) => option.value === draft.state) ?? stateOptions.at(-1)
  const valid = draft.date.length > 0 && selectedState

  function updateDraft(
    changes: Partial<UpdateTableDraft>,
    autosaveObservation = false
  ): void {
    const nextDraft = { ...draftRef.current, ...changes }
    draftRef.current = nextDraft
    setDraft(nextDraft)
    if (creating) return
    if (autosaveObservation) autosave.schedule(nextDraft)
    else autosave.updatePending(nextDraft)
  }

  async function save(): Promise<void> {
    if (!valid) return
    setError(null)
    if (!creating) {
      await autosave.flush(draftRef.current)
      return
    }
    setCreatingSave(true)
    try {
      await onSave(draftRef.current)
    } catch {
      setError(creating ? 'The update could not be created.' : 'The update could not be saved.')
    } finally {
      setCreatingSave(false)
    }
  }

  async function remove(): Promise<void> {
    if (!onDelete) return
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
    } catch {
      setError('The update could not be deleted.')
      setDeleting(false)
    }
  }

  return (
    <tr
      className="border-b border-border/65 align-top last:border-b-0"
      data-update-id={row.id}
      onBlur={(event) => {
        if (
          !creating &&
          !event.currentTarget.contains(event.relatedTarget) &&
          draftRef.current.date.length > 0
        ) {
          void autosave.flush(draftRef.current)
        }
      }}
    >
      <td className="w-36 p-2">
        <Input
          type="date"
          aria-label={`${creating ? 'New update' : 'Update'} date`}
          value={draft.date}
          onChange={(event) => updateDraft({ date: event.target.value })}
        />
      </td>
      <td className="min-w-64 p-2">
        <RichTextEditor
          ariaLabel={`${creating ? 'New update' : 'Update'} observation`}
          placeholder="What changed?"
          value={draft.observation}
          onChange={(observation) => updateDraft({ observation }, true)}
          compact
        />
        {(error !== null || autosave.error !== null) && (
          <p role="alert" className="mt-1.5 text-xs text-destructive">
            {error ?? 'The update could not be saved.'}
          </p>
        )}
      </td>
      <td className="w-36 p-2">
        <div className="space-y-2">
          <select
            aria-label={`${creating ? 'New update' : 'Update'} state`}
            className="h-9 w-full rounded-lg border border-border bg-background/75 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
            value={draft.state}
            onChange={(event) => updateDraft({ state: event.target.value })}
          >
            {stateOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {selectedState && <StateLabel model={selectedState} />}
        </div>
      </td>
      <td className="w-20 p-2">
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={creating ? 'Create update' : 'Save update'}
            disabled={!valid || saving || deleting}
            onClick={() => void save()}
          >
            <Save aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label={creating ? 'Cancel new update' : 'Delete update'}
            disabled={saving || deleting}
            onClick={creating ? onCancel : () => void remove()}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

export function UpdateTable({
  rows,
  stateOptions,
  defaultDate,
  loading = false,
  loadError,
  onCreate,
  onUpdate,
  onDelete
}: UpdateTableProps): React.JSX.Element {
  validateUpdateTableModel(rows, stateOptions)
  const [creating, setCreating] = useState(false)

  return (
    <section className="mt-8" aria-labelledby="commitment-updates-heading">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="commitment-updates-heading" className="text-sm font-semibold">Updates</h2>
        <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          Add update
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border/80 bg-card/45">
        <table className="w-full table-fixed" aria-label="Commitment updates">
          <thead className="border-b border-border/75 bg-muted/35 text-left text-[0.6875rem] font-semibold text-muted-foreground">
            <tr>
              <th scope="col" className="w-36 px-3 py-2">Date</th>
              <th scope="col" className="px-3 py-2">Observation</th>
              <th scope="col" className="w-36 px-3 py-2">State</th>
              <th scope="col" className="w-20 px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {creating && (
              <UpdateEditorRow
                row={{ id: 'new', date: defaultDate, observation: '', state: 'none' }}
                stateOptions={stateOptions}
                creating
                onSave={async (draft) => {
                  await onCreate(draft)
                  setCreating(false)
                }}
                onCancel={() => setCreating(false)}
              />
            )}
            {rows.map((row) => (
              <UpdateEditorRow
                key={row.id}
                row={row}
                stateOptions={stateOptions}
                onSave={(draft) => onUpdate(row.id, draft)}
                onDelete={() => onDelete(row.id)}
              />
            ))}
            {!creating && rows.length === 0 && !loading && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-muted-foreground">No updates yet.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-muted-foreground">Loading updates…</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {loadError && <p role="alert" className="mt-2 text-xs text-destructive">{loadError}</p>}
    </section>
  )
}
