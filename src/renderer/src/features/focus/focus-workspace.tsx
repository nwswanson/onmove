import { useEffect, useState } from 'react'
import {
  ChevronRight,
  Circle,
  Layers3,
  PauseCircle
} from 'lucide-react'
import type {
  CommitmentSnapshot,
  CreateCommitmentInput,
  CreateThreadInput,
  FocusSnapshot,
  ThreadSnapshot,
  UpdateFocusInput
} from '../../../../shared/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ContextualSidebar,
  ContextualSidebarLevel,
  ContextualSidebarNavigation,
  useContextualSidebarNavigation
} from '@/components/ui/contextual-sidebar'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { Textarea } from '@/components/ui/textarea'

const CONTEXTUAL_SIDEBAR_MIN = 220
const CONTEXTUAL_SIDEBAR_MAX = 320

type FocusContextItem =
  | { id: 'overall'; kind: 'overall'; title: 'Overall' }
  | { id: string; kind: 'thread'; thread: ThreadSnapshot }

function focusContextItems(threads: readonly ThreadSnapshot[]): FocusContextItem[] {
  return [
    { id: 'overall', kind: 'overall', title: 'Overall' },
    ...threads.map((thread) => ({
      id: `thread:${thread.id}`,
      kind: 'thread' as const,
      thread
    }))
  ]
}

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
  onUpdateFocus: (input: UpdateFocusInput) => Promise<void>
}

export function FocusWorkspace({
  focus,
  onUpdateFocus
}: FocusWorkspaceProps): React.JSX.Element {
  const [goal, setGoal] = useState(focus.goal)
  const [goalSaving, setGoalSaving] = useState(false)
  const [goalError, setGoalError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  const [newCommitmentOpen, setNewCommitmentOpen] = useState(false)
  const [contextualSidebarWidth, setContextualSidebarWidth] = useState(252)

  const [focusLevel] = useState(
    () =>
      new ContextualSidebarLevel<FocusContextItem>({
        id: `focus:${focus.id}`,
        title: 'Focus',
        ariaLabel: 'Focus sections',
        items: focusContextItems([]),
        getItemId: (item) => item.id,
        getItemAriaLabel: (item) =>
          item.kind === 'overall'
            ? item.title
            : `${item.thread.title}${item.thread.status === 'paused' ? ', paused' : ''}`,
        getItemGroup: (item) =>
          item.kind === 'overall'
            ? { id: 'focus', label: 'Focus' }
            : { id: 'threads', label: 'Threads' },
        getItemClassName: (item) =>
          item.kind === 'thread' && item.thread.status === 'paused'
            ? 'text-muted-foreground opacity-55'
            : undefined,
        renderItem: (item) =>
          item.kind === 'overall' ? (
            <>
              <Layers3 aria-hidden="true" />
              <span className="truncate">{item.title}</span>
            </>
          ) : (
            <>
              {item.thread.status === 'paused' ? (
                <PauseCircle aria-hidden="true" />
              ) : (
                <Circle aria-hidden="true" />
              )}
              <span className="truncate">{item.thread.title}</span>
            </>
          ),
        newItem: {
          label: 'New thread',
          onCreate: () => setNewThreadOpen(true)
        }
      })
  )

  const [commitmentsLevel] = useState(
    () =>
      new ContextualSidebarLevel<CommitmentSnapshot>({
        id: `focus:${focus.id}:commitments`,
        title: 'Commitments',
        ariaLabel: 'Focus commitments',
        parent: focusLevel,
        parentItemId: 'overall',
        items: [],
        getItemId: (commitment) => String(commitment.id),
        getItemAriaLabel: (commitment) => commitment.title,
        getItemClassName: () => 'h-auto min-h-9 py-2',
        newItem: {
          label: 'New commitment',
          onCreate: () => setNewCommitmentOpen(true)
        },
        renderItem: (commitment) => (
          <>
            <span className="min-w-0 flex-1 line-clamp-2">{commitment.title}</span>
            <ChevronRight className="ml-auto" aria-hidden="true" />
          </>
        )
      })
  )

  const [navigation] = useState(
    () => new ContextualSidebarNavigation(focusLevel)
  )
  const navigationSnapshot = useContextualSidebarNavigation(navigation)

  useEffect(() => {
    let active = true
    Promise.all([
      window.onmove.domain.listThreads(focus.id),
      window.onmove.domain.listCommitments({ type: 'focus', id: focus.id })
    ]).then(
      ([nextThreads, nextCommitments]) => {
        if (!active) return
        focusLevel.setItems(focusContextItems(nextThreads))
        commitmentsLevel.setItems(nextCommitments)
        navigation.refresh()
      },
      () => active && setLoadError('The focus workspace could not be loaded.')
    )
    return () => {
      active = false
    }
  }, [commitmentsLevel, focus.id, focusLevel, navigation])

  const commitments = commitmentsLevel.items

  const selectedFocusItem =
    navigationSnapshot.level === focusLevel && navigationSnapshot.selectedItemId
      ? focusLevel.getItem(navigationSnapshot.selectedItemId)
      : undefined
  const selectedCommitment =
    navigationSnapshot.level === commitmentsLevel && navigationSnapshot.selectedItemId
      ? commitmentsLevel.getItem(navigationSnapshot.selectedItemId)
      : undefined

  async function saveGoal(): Promise<void> {
    const normalizedGoal = goal.trim()
    if (normalizedGoal === focus.goal) return
    setGoal(normalizedGoal)
    setGoalSaving(true)
    setGoalError(null)
    try {
      await onUpdateFocus({ goal: normalizedGoal })
    } catch {
      setGoalError('The goal could not be saved.')
    } finally {
      setGoalSaving(false)
    }
  }

  async function createThread(input: CreateThreadInput): Promise<void> {
    const created = await window.onmove.domain.createThread(input)
    const existingThreads = focusLevel.items.flatMap((item) =>
      item.kind === 'thread' ? [item.thread] : []
    )
    focusLevel.setItems(focusContextItems([...existingThreads, created]))
    navigation.refresh()
  }

  async function createCommitment(input: CreateCommitmentInput): Promise<void> {
    const created = await window.onmove.domain.createCommitment(input)
    commitmentsLevel.setItems([...commitmentsLevel.items, created])
    navigation.refresh()
    if (navigation.getSnapshot().level === commitmentsLevel) {
      navigation.select(String(created.id))
    }
  }

  function openCommitments(commitmentId?: number): void {
    navigation.navigateTo(commitmentsLevel)
    if (commitmentId !== undefined) navigation.select(String(commitmentId))
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <ContextualSidebar
        navigation={navigation}
        style={{ width: contextualSidebarWidth }}
      />
      <ResizeHandle
        label="Resize contextual sidebar"
        value={contextualSidebarWidth}
        min={CONTEXTUAL_SIDEBAR_MIN}
        max={CONTEXTUAL_SIDEBAR_MAX}
        direction={1}
        onChange={setContextualSidebarWidth}
      />

      <main className="min-w-0 flex-1 overflow-auto bg-background">
        {navigationSnapshot.level === commitmentsLevel ? (
          <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="commitment-heading">
            {selectedCommitment ? (
              <>
                <p className="mb-2 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  Commitment
                </p>
                <h1 id="commitment-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                  {selectedCommitment.title}
                </h1>
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
        ) : selectedFocusItem?.kind === 'thread' ? (
          <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="thread-heading">
            <h1 id="thread-heading" className="text-2xl font-semibold tracking-[-0.025em]">
              {selectedFocusItem.thread.title}
            </h1>
          </section>
        ) : (
          <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="focus-heading">
            <div className="flex items-start gap-3 border-b border-border/70 pb-6">
              <div className="min-w-0 flex-1">
                <h1 id="focus-heading" className="truncate text-2xl font-semibold tracking-[-0.025em]">
                  {focus.title}
                </h1>
                <p className="mt-1.5 max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
                  {focus.description ?? 'No description or notes.'}
                </p>
              </div>
              <Badge variant="outline" className="capitalize">{focus.status}</Badge>
            </div>

            <div className="mt-6">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor="focus-goal" className="text-xs font-semibold">Goal</label>
                {goalSaving && <span className="text-xs text-muted-foreground">Saving…</span>}
              </div>
              <Textarea
                id="focus-goal"
                aria-label="Goal"
                className="min-h-20"
                placeholder="What should this focus accomplish?"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                onBlur={() => void saveGoal()}
              />
              {goalError && <p role="alert" className="mt-2 text-xs text-destructive">{goalError}</p>}
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

              <div className="overflow-hidden rounded-xl border border-border/80 bg-card/45">
                <div role="list" aria-label="Focus commitments">
                  {commitments.map((commitment) => (
                    <div key={commitment.id} role="listitem" className="border-b border-border/65 last:border-b-0">
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
                        aria-label={`Open commitment ${commitment.title}`}
                        onClick={() => openCommitments(commitment.id)}
                      >
                        <span className="min-w-0 flex-1 truncate">{commitment.title}</span>
                        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {commitments.length === 0 && (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No commitments
                    </p>
                  )}
                </div>
              </div>
            </section>

            {loadError && <p role="alert" className="mt-5 text-sm text-destructive">{loadError}</p>}
          </section>
        )}
      </main>

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
    </div>
  )
}
