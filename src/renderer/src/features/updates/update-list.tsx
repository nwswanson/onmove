import { useId, useRef, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { StateLabel } from '@/components/ui/state-label'
import { SensitivityToggle } from '@/features/shared/sensitivity-toggle'
import {
  validateUpdateListModel,
  type UpdateListDraft,
  type UpdateListItemModel,
  type UpdateListProps,
  type UpdateListStateOptionModel
} from '@/features/updates/update-list-contract'
import { useThrottledAutosave } from '@/lib/use-throttled-autosave'

function updateDraftsEqual(left: UpdateListDraft, right: UpdateListDraft): boolean {
  return (
    left.date === right.date &&
    left.observation === right.observation &&
    left.state === right.state &&
    left.sensitive === right.sensitive
  )
}

function UpdateEditorCard({
  item,
  stateOptions,
  onSave,
  onDelete
}: {
  item: UpdateListItemModel
  stateOptions: readonly UpdateListStateOptionModel[]
  onSave: (draft: UpdateListDraft) => Promise<void>
  onDelete: () => Promise<void>
}): React.JSX.Element {
  const initialDraft: UpdateListDraft = {
    date: item.date,
    observation: item.observation,
    state: item.state,
    sensitive: item.sensitive
  }
  const [draft, setDraft] = useState<UpdateListDraft>(initialDraft)
  const draftRef = useRef(initialDraft)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autosave = useThrottledAutosave({
    initialValue: initialDraft,
    isEqual: updateDraftsEqual,
    onSave
  })

  const selectedState =
    stateOptions.find((option) => option.value === draft.state) ?? stateOptions.at(-1)

  function updateDraft(changes: Partial<UpdateListDraft>): void {
    const nextDraft = { ...draftRef.current, ...changes }
    draftRef.current = nextDraft
    setDraft(nextDraft)
    autosave.schedule(nextDraft)
  }

  async function remove(): Promise<void> {
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
    } catch {
      setError('The update could not be deleted.')
      setDeleting(false)
    }
  }

  const fieldPrefix = `update-${item.id}`

  return (
    <article
      role="listitem"
      aria-label={`Update from ${draft.date}`}
      className="overflow-hidden rounded-xl border border-border/80 bg-card/55 shadow-xs"
      data-update-id={item.id}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          draftRef.current.date.length > 0
        ) {
          void autosave.flush(draftRef.current)
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-3 border-b border-border/65 bg-muted/20 p-3">
        {item.contextLabel && (
          <span className="self-center rounded-full border border-primary/45 bg-primary/15 px-2 py-1 text-[0.6875rem] font-semibold">
            {item.contextLabel}
          </span>
        )}
        <label className="flex min-w-0 flex-[1_1_9rem] flex-col gap-1 sm:max-w-48">
          <span className="text-[0.6875rem] font-medium text-muted-foreground">Date</span>
          <Input
            id={`${fieldPrefix}-date`}
            type="date"
            aria-label="Update date"
            value={draft.date}
            onChange={(event) => updateDraft({ date: event.target.value })}
          />
        </label>

        <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1">
          <label
            htmlFor={`${fieldPrefix}-state`}
            className="text-[0.6875rem] font-medium text-muted-foreground"
          >
            State
          </label>
          <div className="flex min-w-0 items-center gap-2">
            <select
              id={`${fieldPrefix}-state`}
              aria-label="Update state"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background/75 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
              value={draft.state}
              onChange={(event) => updateDraft({ state: event.target.value })}
            >
              {stateOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {selectedState && <StateLabel model={selectedState} />}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
          <SensitivityToggle
            checked={draft.sensitive}
            disabled={autosave.saving || deleting}
            onCheckedChange={(sensitive) => updateDraft({ sensitive })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground hover:text-destructive"
            aria-label="Delete update"
            disabled={autosave.saving || deleting}
            onClick={() => void remove()}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="p-3">
        <div className="mb-1.5 flex min-h-4 items-center justify-between gap-3">
          <label htmlFor={`${fieldPrefix}-observation`} className="text-xs font-medium">
            Observation
          </label>
          {autosave.saving && (
            <span role="status" className="text-xs text-muted-foreground">Saving…</span>
          )}
        </div>
        <RichTextEditor
          id={`${fieldPrefix}-observation`}
          ariaLabel="Update observation"
          placeholder="What changed?"
          value={draft.observation}
          onChange={(observation) => updateDraft({ observation })}
          compact
        />
        {(error !== null || autosave.error !== null) && (
          <p role="alert" className="mt-1.5 text-xs text-destructive">
            {error ?? 'The update could not be saved.'}
          </p>
        )}
      </div>
    </article>
  )
}

export function UpdateList({
  ariaLabel,
  heading = 'Updates',
  supportingText,
  emptyLabel = 'No updates yet.',
  items,
  formerItems = [],
  formerItemsLabel = 'Former scope updates',
  stateOptions,
  defaultDate,
  defaultState,
  loading = false,
  loadError,
  onCreate,
  createOptions = [],
  createOptionsLabel = 'Add update for…',
  onCreateFor,
  onUpdate,
  onDelete
}: UpdateListProps): React.JSX.Element {
  if (ariaLabel.trim().length === 0) throw new Error('An Update list requires an accessible label.')
  if (!formerItemsLabel.trim()) throw new Error('A former Update collection requires a label.')
  validateUpdateListModel([...items, ...formerItems], stateOptions, createOptions)
  if (onCreate && onCreateFor) {
    throw new Error('An Update list cannot use both direct and choice-based creation.')
  }
  if ((createOptions.length > 0) !== Boolean(onCreateFor)) {
    throw new Error('An Update list requires creation options and their handler together.')
  }
  if (onCreateFor && !createOptionsLabel.trim()) {
    throw new Error('An Update list choice-based creation control requires an accessible label.')
  }
  if (defaultDate.trim().length === 0) throw new Error('An Update list requires a default date.')
  if (!stateOptions.some((option) => option.value === defaultState)) {
    throw new Error(`Update list contains an invalid default state "${defaultState}".`)
  }
  const [adding, setAdding] = useState(false)
  const [createOptionId, setCreateOptionId] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [formerItemsOpen, setFormerItemsOpen] = useState(false)
  const headingId = useId()
  const formerItemsId = useId()

  async function addUpdate(): Promise<void> {
    setAdding(true)
    setCreateError(null)
    try {
      if (!onCreate) return
      await onCreate({
        date: defaultDate,
        observation: '',
        state: defaultState,
        sensitive: false
      })
    } catch {
      setCreateError('The update could not be added.')
    } finally {
      setAdding(false)
    }
  }

  async function addUpdateFor(optionId: string): Promise<void> {
    if (!onCreateFor || !optionId) return
    setCreateOptionId(optionId)
    setAdding(true)
    setCreateError(null)
    try {
      await onCreateFor(optionId, {
        date: defaultDate,
        observation: '',
        state: defaultState,
        sensitive: false
      })
    } catch {
      setCreateError('The update could not be added.')
    } finally {
      setCreateOptionId('')
      setAdding(false)
    }
  }

  return (
    <section className="mt-8" aria-labelledby={headingId}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-48 flex-1">
          <h2 id={headingId} className="text-sm font-semibold">{heading}</h2>
          {supportingText && (
            <p className="mt-0.5 text-xs text-muted-foreground">{supportingText}</p>
          )}
        </div>
        {onCreate && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={adding}
            onClick={() => void addUpdate()}
          >
            <Plus aria-hidden="true" />
            {adding ? 'Adding…' : 'Add update'}
          </Button>
        )}
        {onCreateFor && (
          <div className="relative shrink-0">
            <Plus
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
            />
            <select
              aria-label={createOptionsLabel}
              value={createOptionId}
              disabled={adding}
              className="h-9 max-w-64 appearance-none rounded-md border border-input bg-background pl-8 pr-8 text-sm font-medium shadow-xs outline-none hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50"
              onChange={(event) => void addUpdateFor(event.target.value)}
            >
              <option value="">{adding ? 'Adding…' : createOptionsLabel}</option>
              {createOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        )}
      </div>
      <div role="list" aria-label={ariaLabel} className="space-y-3">
        {items.map((item) => (
          <UpdateEditorCard
            key={item.id}
            item={item}
            stateOptions={stateOptions}
            onSave={(draft) => onUpdate(item.id, draft)}
            onDelete={() => onDelete(item.id)}
          />
        ))}
        {items.length === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-border/80 px-4 py-10 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </div>
        )}
        {loading && (
          <div role="status" className="rounded-xl border border-border/70 bg-card/35 px-4 py-10 text-center text-xs text-muted-foreground">
            Loading updates…
          </div>
        )}
      </div>
      {createError && <p role="alert" className="mt-2 text-xs text-destructive">{createError}</p>}
      {loadError && <p role="alert" className="mt-2 text-xs text-destructive">{loadError}</p>}
      {formerItems.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-border/75 bg-muted/15">
          <button
            type="button"
            aria-expanded={formerItemsOpen}
            aria-controls={formerItemsId}
            className="flex w-full items-center gap-2 px-3.5 py-3 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
            onClick={() => setFormerItemsOpen((open) => !open)}
          >
            <ChevronDown
              aria-hidden="true"
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${formerItemsOpen ? 'rotate-180' : ''}`}
            />
            <span className="text-xs font-semibold">{formerItemsLabel}</span>
            <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
              {formerItems.length}
            </span>
          </button>
          <div
            id={formerItemsId}
            hidden={!formerItemsOpen}
            role="list"
            aria-label={formerItemsLabel}
            className="space-y-3 border-t border-border/70 p-3"
          >
            {formerItems.map((item) => (
              <UpdateEditorCard
                key={item.id}
                item={item}
                stateOptions={stateOptions}
                onSave={(draft) => onUpdate(item.id, draft)}
                onDelete={() => onDelete(item.id)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
