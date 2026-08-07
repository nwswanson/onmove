import { Fragment, useEffect, useState } from 'react'
import {
  ChevronRight,
  Info
} from 'lucide-react'
import type {
  CommitmentSnapshot,
  CommitmentStatus,
  CreateCommitmentInput,
  CreateThreadInput,
  FocusSnapshot,
  UpdateFocusInput
} from '../../../../shared/contracts'
import { Badge } from '@/components/ui/badge'
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
  useContextualSidebarNavigation
} from '@/components/ui/contextual-sidebar'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  LifecycleStatusLabel,
  LifecycleStatusSelect
} from '@/components/ui/lifecycle-status'
import { RichTextContent, RichTextEditor } from '@/components/ui/rich-text-editor'
import { StateLabel } from '@/components/ui/state-label'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import {
  COMMITMENT_STATUS_OPTIONS,
  commitmentContextSidebarItems,
  commitmentDrawerAdapter,
  commitmentStatusLabel,
  dateOrNeverLabel,
  focusContextSidebarItems,
  focusDrawerAdapter,
  threadDrawerAdapter,
  threadSidebarItemId
} from '@/features/focus/focus-presenters'
import { useFocusWorkspaceModel } from '@/features/focus/use-focus-workspace-model'
import { healthStateLabel } from '@/features/shared/state-presenters'
import { DirectUpdates } from '@/features/updates/direct-updates'

const CONTEXTUAL_SIDEBAR_MIN = 220
const CONTEXTUAL_SIDEBAR_MAX = 320

interface NewThreadDialogProps {
  focusId: number
  onClose: () => void
  onCreate: (input: CreateThreadInput) => Promise<void>
}

function NewThreadDialog({
  focusId,
  onClose,
  onCreate
}: NewThreadDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [reviewFrequencyDays, setReviewFrequencyDays] = useState(7)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (title.trim().length === 0 || reviewFrequencyDays <= 0) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({
        focusId,
        title,
        reviewFrequencyDays
      })
      onClose()
    } catch {
      setError('The thread could not be created. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title="New thread"
      description="Add another dimension for judging this focus."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-thread-form"
            disabled={saving || title.trim().length === 0 || reviewFrequencyDays <= 0}
          >
            {saving ? 'Creating…' : 'Create thread'}
          </Button>
        </>
      }
    >
      <form id="new-thread-form" className="space-y-4" onSubmit={submit}>
        <DialogField>
          <label htmlFor="new-thread-title" className="text-xs font-medium">
            Title <span className="text-destructive">*</span>
          </label>
          <Input
            id="new-thread-title"
            autoFocus
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </DialogField>
        <DialogField>
          <label htmlFor="new-thread-frequency" className="text-xs font-medium">
            Review every (days)
          </label>
          <Input
            id="new-thread-frequency"
            type="number"
            min={1}
            step={1}
            required
            value={reviewFrequencyDays}
            onChange={(event) => setReviewFrequencyDays(Number(event.target.value))}
          />
        </DialogField>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </form>
    </Dialog>
  )
}

interface NewCommitmentDialogProps {
  focusId: number
  onClose: () => void
  onCreate: (input: CreateCommitmentInput) => Promise<void>
}

function NewCommitmentDialog({
  focusId,
  onClose,
  onCreate
}: NewCommitmentDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (title.trim().length === 0) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({
        parent: { type: 'focus', id: focusId },
        type: 'ongoing',
        title
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
      description="Add a focus-level commitment."
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
      <form id="new-commitment-form" onSubmit={submit}>
        <DialogField>
          <label htmlFor="new-commitment-title" className="text-xs font-medium">
            Title <span className="text-destructive">*</span>
          </label>
          <Input
            id="new-commitment-title"
            autoFocus
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </DialogField>
        {error && <p role="alert" className="mt-4 text-xs text-destructive">{error}</p>}
      </form>
    </Dialog>
  )
}

interface FocusWorkspaceProps {
  focus: FocusSnapshot
  contextDrawer: ContextDrawerControl
  onUpdateFocus: (input: UpdateFocusInput) => Promise<void>
  onRefreshFocus: () => Promise<FocusSnapshot>
  onDeleteFocus: () => Promise<void>
}

export function FocusWorkspace({
  focus,
  contextDrawer,
  onUpdateFocus,
  onRefreshFocus,
  onDeleteFocus
}: FocusWorkspaceProps): React.JSX.Element {
  const model = useFocusWorkspaceModel({ focus, onUpdateFocus })
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  const [newCommitmentOpen, setNewCommitmentOpen] = useState(false)
  const [contextualSidebarWidth, setContextualSidebarWidth] = useState(252)
  const [commitmentStatusSavingId, setCommitmentStatusSavingId] = useState<number | null>(null)
  const [commitmentStatusError, setCommitmentStatusError] = useState<{
    id: number
    message: string
  } | null>(null)

  const [focusLevel] = useState(
    () =>
      new ContextualSidebarLevel({
        id: `focus:${focus.id}`,
        title: 'Focus',
        ariaLabel: 'Focus sections',
        items: focusContextSidebarItems([]),
        newItem: {
          label: 'New thread',
          onCreate: () => setNewThreadOpen(true)
        }
      })
  )

  const [commitmentsLevel] = useState(
    () =>
      new ContextualSidebarLevel({
        id: `focus:${focus.id}:commitments`,
        title: 'Commitments',
        ariaLabel: 'Focus commitments',
        parent: focusLevel,
        parentItemId: 'overall',
        items: [],
        newItem: {
          label: 'New commitment',
          onCreate: () => setNewCommitmentOpen(true)
        }
      })
  )

  const [navigation] = useState(
    () => new ContextualSidebarNavigation(focusLevel)
  )
  const navigationSnapshot = useContextualSidebarNavigation(navigation)

  useEffect(() => {
    focusLevel.setItems(focusContextSidebarItems(model.threads))
    commitmentsLevel.setItems(commitmentContextSidebarItems(model.commitments))
    navigation.refresh()
  }, [commitmentsLevel, focusLevel, model.commitments, model.threads, navigation])

  const selectedThread =
    navigationSnapshot.level === focusLevel && navigationSnapshot.selectedItemId
      ? model.threads.find(
          (thread) => threadSidebarItemId(thread.id) === navigationSnapshot.selectedItemId
        )
      : undefined
  const selectedCommitment =
    navigationSnapshot.level === commitmentsLevel && navigationSnapshot.selectedItemId
      ? model.commitments.find(
          (commitment) => String(commitment.id) === navigationSnapshot.selectedItemId
        )
      : undefined

  const contextDrawerAdapter: ContextDrawerAdapter | null = selectedCommitment
    ? commitmentDrawerAdapter(selectedCommitment, focus.title, [`focus:${focus.id}`])
    : navigationSnapshot.level === commitmentsLevel
      ? null
      : selectedThread
        ? threadDrawerAdapter(selectedThread, focus.title, (input) =>
            model.updateThread(selectedThread.id, input).then(() => undefined)
          )
        : focusDrawerAdapter({ focus, onSave: onUpdateFocus, onDelete: onDeleteFocus })

  async function createThread(input: CreateThreadInput): Promise<void> {
    await model.createThread(input)
  }

  async function createCommitment(input: CreateCommitmentInput): Promise<void> {
    const created = await model.createCommitment(input)
    commitmentsLevel.setItems(
      commitmentContextSidebarItems([...model.commitments, created])
    )
    navigation.refresh()
    if (navigation.getSnapshot().level === commitmentsLevel) {
      navigation.select(String(created.id))
    }
  }

  async function updateCommitmentStatus(
    commitmentId: number,
    status: CommitmentStatus
  ): Promise<void> {
    setCommitmentStatusSavingId(commitmentId)
    setCommitmentStatusError(null)
    try {
      const updated = await model.updateCommitment(commitmentId, { status })
      if (contextDrawer.pinnedAdapter?.id === `commitment:${commitmentId}`) {
        contextDrawer.onPin(
          commitmentDrawerAdapter(updated, focus.title, [`focus:${focus.id}`])
        )
      }
    } catch {
      setCommitmentStatusError({
        id: commitmentId,
        message: 'The commitment status could not be updated. Please try again.'
      })
    } finally {
      setCommitmentStatusSavingId(null)
    }
  }

  async function refreshFocusAfterUpdates(): Promise<void> {
    const updated = await onRefreshFocus()
    if (contextDrawer.pinnedAdapter?.id === `focus:${focus.id}`) {
      contextDrawer.onPin(
        focusDrawerAdapter({
          focus: updated,
          onSave: onUpdateFocus,
          onDelete: onDeleteFocus
        })
      )
    }
  }

  function openCommitments(commitmentId?: number): void {
    navigation.navigateTo(commitmentsLevel)
    if (commitmentId !== undefined) navigation.select(String(commitmentId))
  }

  function renderCommitmentRow(commitment: CommitmentSnapshot): React.JSX.Element {
    return (
      <div
        key={commitment.id}
        role="listitem"
        className="flex items-center border-b border-border/65 last:border-b-0"
      >
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
          aria-label={`Open commitment ${commitment.title}`}
          aria-describedby={`commitment-${commitment.id}-last-updated`}
          onClick={() => openCommitments(commitment.id)}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate">{commitment.title}</span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <LifecycleStatusLabel
                model={commitmentStatusLabel(commitment.status)}
                size="compact"
              />
              <span
                id={`commitment-${commitment.id}-last-updated`}
                className="min-w-0 truncate text-xs text-muted-foreground"
              >
                Last updated · {dateOrNeverLabel(commitment.lastUpdateDate)}
              </span>
            </span>
          </span>
          <StateLabel model={healthStateLabel(commitment.state)} size="compact" />
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mr-1 size-8 text-muted-foreground"
          aria-label={`Pin commitment ${commitment.title} in context drawer`}
          title="Pin in context drawer"
          onClick={() =>
            contextDrawer.onPin(
              commitmentDrawerAdapter(
                commitment,
                focus.title,
                [`focus:${focus.id}`]
              )
            )
          }
        >
          <Info aria-hidden="true" />
        </Button>
      </div>
    )
  }

  const main = (
    <main className="min-w-0 flex-1 overflow-auto bg-background">
        {navigationSnapshot.level === commitmentsLevel ? (
          <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="commitment-heading">
            {selectedCommitment ? (
              <>
                <div className="flex items-start justify-between gap-4 border-b border-border/70 pb-5">
                  <div className="min-w-0 flex-1">
                    <p className="mb-2 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                      Commitment
                    </p>
                    <h1 id="commitment-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                      {selectedCommitment.title}
                    </h1>
                    <p
                      aria-label="Commitment last updated"
                      className="mt-2 text-xs text-muted-foreground"
                    >
                      <span className="font-medium text-foreground/80">Last updated</span>
                      {' · '}{dateOrNeverLabel(selectedCommitment.lastUpdateDate)}
                    </p>
                  </div>
                  <LifecycleStatusSelect
                    aria-label="Commitment status"
                    value={selectedCommitment.status}
                    options={COMMITMENT_STATUS_OPTIONS}
                    disabled={commitmentStatusSavingId === selectedCommitment.id}
                    onValueChange={(status) =>
                      void updateCommitmentStatus(
                        selectedCommitment.id,
                        status as CommitmentStatus
                      )
                    }
                  />
                </div>
                {commitmentStatusError?.id === selectedCommitment.id && (
                  <p role="alert" className="mt-3 text-xs text-destructive">
                    {commitmentStatusError.message}
                  </p>
                )}
                <DirectUpdates
                  key={selectedCommitment.id}
                  parent={{ type: 'commitment', id: selectedCommitment.id }}
                  onUpdatesChanged={model.refreshCommitments}
                />
              </>
            ) : (
              <>
                <h1 id="commitment-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                  Commitments
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">No commitments yet.</p>
              </>
            )}
          </section>
        ) : selectedThread ? (
          <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="thread-heading">
            <h1 id="thread-heading" className="text-2xl font-semibold tracking-[-0.025em]">
              {selectedThread.title}
            </h1>
            <p
              aria-label="Thread last reviewed"
              className="mt-2 text-xs text-muted-foreground"
            >
              <span className="font-medium text-foreground/80">Last reviewed</span>
              {' · '}{dateOrNeverLabel(selectedThread.lastReviewDate)}
            </p>
          </section>
        ) : (
          <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="focus-heading">
            <div className="flex items-start gap-3 border-b border-border/70 pb-6">
              <div className="min-w-0 flex-1">
                <h1 id="focus-heading" className="truncate text-2xl font-semibold tracking-[-0.025em]">
                  {focus.title}
                </h1>
                <p
                  aria-label="Focus last reviewed"
                  className="mt-1.5 text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground/80">Last reviewed</span>
                  {' · '}{dateOrNeverLabel(focus.lastReviewDate)}
                </p>
                {focus.description ? (
                  <RichTextContent
                    value={focus.description}
                    ariaLabel="Focus description"
                    className="mt-1.5 max-w-2xl text-muted-foreground"
                  />
                ) : (
                  <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                    No description or notes.
                  </p>
                )}
              </div>
              <Badge variant="outline" className="capitalize">{focus.status}</Badge>
            </div>

            <div className="mt-6">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor="focus-goal" className="text-xs font-semibold">Goal</label>
                {model.goalSaving && <span className="text-xs text-muted-foreground">Saving…</span>}
              </div>
              <RichTextEditor
                id="focus-goal"
                ariaLabel="Goal"
                placeholder="What should this focus accomplish?"
                value={model.goal}
                onChange={model.setGoal}
                onBlur={(value) => void model.saveGoal(value)}
              />
              {model.goalError && <p role="alert" className="mt-2 text-xs text-destructive">{model.goalError}</p>}
            </div>

            <section className="mt-8" aria-labelledby="focus-commitments-heading">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 id="focus-commitments-heading" className="text-sm font-semibold">
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md px-1 py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/55"
                    onClick={() => openCommitments()}
                  >
                    Commitments
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </button>
                </h2>
              </div>

              <div className="space-y-5">
                <section aria-labelledby="current-commitments-heading">
                  <h3
                    id="current-commitments-heading"
                    className="mb-2 text-xs font-semibold text-muted-foreground"
                  >
                    Current
                  </h3>
                  <div
                    role="list"
                    aria-label="Current commitments"
                    className="overflow-hidden rounded-xl border border-border/80 bg-card/45"
                  >
                    {model.commitmentList.groups.slice(0, 2).map((group) =>
                      group.commitments.length > 0 ? (
                        <Fragment key={group.id}>
                          <div
                            role="presentation"
                            className="border-b border-border/65 bg-muted/35 px-3 py-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                          >
                            {group.label}
                          </div>
                          {group.commitments.map(renderCommitmentRow)}
                        </Fragment>
                      ) : null
                    )}
                    {model.commitmentList.current.length === 0 && (
                      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                        No active or paused commitments
                      </p>
                    )}
                  </div>
                </section>

                <section aria-labelledby="closed-commitments-heading">
                  <h3
                    id="closed-commitments-heading"
                    className="mb-2 text-xs font-semibold text-muted-foreground"
                  >
                    Done / Cancelled
                  </h3>
                  <div
                    role="list"
                    aria-label="Done and cancelled commitments"
                    className="overflow-hidden rounded-xl border border-border/80 bg-card/45"
                  >
                    {model.commitmentList.closed.map(renderCommitmentRow)}
                    {model.commitmentList.closed.length === 0 && (
                      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                        No done or cancelled commitments
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </section>

            <DirectUpdates
              key={`focus-updates:${focus.id}`}
              parent={{ type: 'focus', id: focus.id }}
              onUpdatesChanged={refreshFocusAfterUpdates}
            />

            {model.loadError && <p role="alert" className="mt-5 text-sm text-destructive">{model.loadError}</p>}
          </section>
        )}
    </main>
  )

  return (
    <>
      <WorkspaceShell
        contextualSidebar={
          <ContextualSidebar
            navigation={navigation}
            style={{ width: contextualSidebarWidth }}
          />
        }
        contextualSidebarResize={{
          label: 'Resize contextual sidebar',
          value: contextualSidebarWidth,
          min: CONTEXTUAL_SIDEBAR_MIN,
          max: CONTEXTUAL_SIDEBAR_MAX,
          direction: 1,
          onChange: setContextualSidebarWidth
        }}
        main={main}
        drawer={<ContextDrawerOutlet adapter={contextDrawerAdapter} {...contextDrawer} />}
      />
      {newThreadOpen && (
        <NewThreadDialog
          focusId={focus.id}
          onClose={() => setNewThreadOpen(false)}
          onCreate={createThread}
        />
      )}
      {newCommitmentOpen && (
        <NewCommitmentDialog
          focusId={focus.id}
          onClose={() => setNewCommitmentOpen(false)}
          onCreate={createCommitment}
        />
      )}
    </>
  )
}
