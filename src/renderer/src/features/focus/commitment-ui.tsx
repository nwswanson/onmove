import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Info, Plus } from 'lucide-react'
import type {
  CommitmentParent,
  CreateCommitmentInput
} from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { TaggedInput, TaggedText } from '@/components/ui/tagged-text'
import {
  LifecycleStatusLabel,
  type LifecycleStatusOptionModel
} from '@/components/ui/lifecycle-status'
import { StateLabel, type StateLabelModel } from '@/components/ui/state-label'
import { legacyCommitmentTypeForDueDate } from '@/features/focus/commitment-list-model'

interface NewCommitmentDialogProps {
  parent: CommitmentParent
  onClose: () => void
  onCreate: (input: CreateCommitmentInput) => Promise<void>
}

/** Parent-agnostic Commitment creation used at every contextual hierarchy level. */
export function NewCommitmentDialog({
  parent,
  onClose,
  onCreate
}: NewCommitmentDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (title.trim().length === 0) return
    setSaving(true)
    setError(null)
    try {
      const normalizedDueDate = dueDate || null
      await onCreate({
        parent,
        title,
        dueDate: normalizedDueDate,
        type: legacyCommitmentTypeForDueDate(normalizedDueDate)
      })
      onClose()
    } catch {
      setError('The commitment could not be created. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title="New commitment"
      description={`Add a ${parent.type === 'focus' ? 'Focus' : 'Thread'}-level commitment.`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-commitment-form"
            disabled={saving || title.trim().length === 0}
          >
            {saving ? 'Creating…' : 'Create commitment'}
          </Button>
        </>
      }
    >
      <form id="new-commitment-form" className="space-y-4" onSubmit={submit}>
        <DialogField>
          <label htmlFor="new-commitment-title" className="text-xs font-medium">
            Title <span className="text-destructive">*</span>
          </label>
          <TaggedInput
            id="new-commitment-title"
            autoFocus
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </DialogField>
        <DialogField>
          <label htmlFor="new-commitment-due-date" className="text-xs font-medium">
            Due date <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="new-commitment-due-date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </DialogField>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </form>
    </Dialog>
  )
}

export interface CommitmentCollectionItemModel {
  id: number
  title: string
  statusLabel: LifecycleStatusOptionModel
  lastUpdatedLabel: string
  dueDateLabel: string | null
  stateLabel: StateLabelModel
  completion: {
    visible: boolean
    checked: boolean
    disabled: boolean
  }
}

export interface CommitmentCollectionGroupModel {
  id: string
  label: string
  items: readonly CommitmentCollectionItemModel[]
}

export interface CommitmentCollectionModel {
  currentCount: number
  closedCount: number
  groups: readonly CommitmentCollectionGroupModel[]
}

interface CommitmentCollectionProps {
  idPrefix: string
  model: CommitmentCollectionModel
  contextLabel?: string
  statusSavingId: number | null
  statusError: { id: number; message: string } | null
  onOpenCollection?: () => void
  onCreate?: () => void
  onOpen: (commitmentId: number) => void
  onPin: (commitmentId: number) => void
  onComplete: (commitmentId: number) => void
}

/** Shared grouped list surface for Commitments belonging to any supported parent. */
export function CommitmentCollection({
  idPrefix,
  model,
  contextLabel,
  statusSavingId,
  statusError,
  onOpenCollection,
  onCreate,
  onOpen,
  onPin,
  onComplete
}: CommitmentCollectionProps): React.JSX.Element {
  const [closedOpen, setClosedOpen] = useState(false)

  function renderRow(item: CommitmentCollectionItemModel): React.JSX.Element {
    const rowError = statusError?.id === item.id ? statusError.message : null
    const lastUpdatedId = `${idPrefix}-commitment-${item.id}-last-updated`
    const errorId = `${idPrefix}-commitment-${item.id}-status-error`

    return (
      <div
        key={item.id}
        role="listitem"
        className="flex items-center border-b border-border/65 last:border-b-0"
      >
        {item.completion.visible && (
          <input
            type="checkbox"
            aria-label={`Mark commitment ${item.title} done`}
            title={item.completion.checked ? 'Commitment is done' : 'Mark done'}
            className="ml-3 size-4 shrink-0 accent-success disabled:cursor-not-allowed disabled:opacity-55"
            checked={item.completion.checked}
            disabled={item.completion.disabled || statusSavingId !== null}
            onChange={(event) => event.currentTarget.checked && onComplete(item.id)}
          />
        )}
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
          aria-label={`Open commitment ${item.title}`}
          aria-describedby={[lastUpdatedId, rowError ? errorId : null].filter(Boolean).join(' ')}
          onClick={() => onOpen(item.id)}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate"><TaggedText value={item.title} /></span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <LifecycleStatusLabel
                model={item.statusLabel}
                size="compact"
              />
              <span id={lastUpdatedId} className="min-w-0 truncate text-xs text-muted-foreground">
                Last updated · {item.lastUpdatedLabel}
              </span>
              {item.dueDateLabel && (
                <span className="text-xs text-muted-foreground">Due · {item.dueDateLabel}</span>
              )}
            </span>
            {rowError && (
              <span id={errorId} role="alert" className="mt-1 block text-xs text-destructive">
                {rowError}
              </span>
            )}
          </span>
          <StateLabel model={item.stateLabel} size="compact" />
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mr-1 size-8 text-muted-foreground"
          aria-label={`Pin commitment ${item.title} in context drawer`}
          title="Pin in context drawer"
          onClick={() => onPin(item.id)}
        >
          <Info aria-hidden="true" />
        </Button>
      </div>
    )
  }

  return (
    <section className="mt-8" aria-labelledby={`${idPrefix}-commitments-heading`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-48 flex-1">
          <h2 id={`${idPrefix}-commitments-heading`} className="text-sm font-semibold">
            {onOpenCollection ? (
              <button
                type="button"
                className="flex items-center gap-1 rounded-md px-1 py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/55"
                onClick={onOpenCollection}
              >
                Commitments
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
              </button>
            ) : 'Commitments'}
          </h2>
          {contextLabel && (
            <p className="mt-0.5 text-xs text-muted-foreground">{contextLabel}</p>
          )}
        </div>
        {onCreate && (
          <Button type="button" variant="outline" size="sm" onClick={onCreate}>
            <Plus aria-hidden="true" />
            Add commitment
          </Button>
        )}
      </div>

      <div className="space-y-5">
        <section aria-labelledby={`${idPrefix}-current-commitments-heading`}>
          <h3
            id={`${idPrefix}-current-commitments-heading`}
            className="mb-2 text-xs font-semibold text-muted-foreground"
          >
            Current
          </h3>
          <div
            role="list"
            aria-label="Current commitments"
            className="overflow-hidden rounded-xl border border-border/80 bg-card/45"
          >
            {model.groups.slice(0, 2).map((group) =>
              group.items.length > 0 ? (
                <Fragment key={group.id}>
                  <div
                    role="presentation"
                    className="border-b border-border/65 bg-muted/35 px-3 py-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                  >
                    {group.label}
                  </div>
                  {group.items.map(renderRow)}
                </Fragment>
              ) : null
            )}
            {model.currentCount === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No active or paused commitments
              </p>
            )}
          </div>
        </section>

        <section
          className="overflow-hidden rounded-xl border border-border/80 bg-card/45"
          aria-labelledby={`${idPrefix}-closed-commitments-heading`}
        >
          <button
            type="button"
            aria-expanded={closedOpen}
            aria-controls={`${idPrefix}-closed-commitments`}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
            onClick={() => setClosedOpen((open) => !open)}
          >
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${closedOpen ? '' : '-rotate-90'}`}
              aria-hidden="true"
            />
            <span
              id={`${idPrefix}-closed-commitments-heading`}
              className="text-xs font-semibold text-muted-foreground"
            >
              Done / Cancelled
            </span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {model.closedCount}
            </span>
          </button>
          {closedOpen && (
            <div
              id={`${idPrefix}-closed-commitments`}
              role="list"
              aria-label="Done and cancelled commitments"
              className="border-t border-border/65"
            >
              {model.groups[2]?.items.map(renderRow)}
              {model.closedCount === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No done or cancelled commitments
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
