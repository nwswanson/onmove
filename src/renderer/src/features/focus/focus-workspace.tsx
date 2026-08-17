import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CommitmentParent,
  CommitmentMovePlanSnapshot,
  CommitmentSnapshot,
  CreateCommitmentInput,
  CreateThreadInput,
  FocusSnapshot,
  RoutineSnapshot,
  SubjectSnapshot,
  ThreadSnapshot,
  ThreadMovePlanSnapshot,
  ThreadScopeSnapshot,
  ThreadSubjectCellSnapshot,
  UpdateCommitmentInput,
  UpdateFocusInput,
  UpdateRoutineInput,
  UpdateThreadInput
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
  type ContextualSidebarChildMove,
  type ContextualSidebarItemMove,
  useContextualSidebarNavigation
} from '@/components/ui/contextual-sidebar'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RichTextContent, RichTextEditor } from '@/components/ui/rich-text-editor'
import { TaggedInput, TaggedText } from '@/components/ui/tagged-text'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { WorkspaceTabBar } from '@/components/ui/workspace-tab-bar'
import type {
  FocusWorkspaceDestination
} from '@/features/application/application-navigation'
import {
  CommitmentCollection,
  NewCommitmentDialog
} from '@/features/focus/commitment-ui'
import {
  buildCommitmentListModel,
  commitmentsForThreadSubject
} from '@/features/focus/commitment-list-model'
import { FocusScopeEditor } from '@/features/focus/focus-scope-ui'
import {
  commitmentCollectionModel,
  commitmentContextSidebarItems,
  commitmentDrawerAdapter,
  commitmentWorkingContextModel,
  dateOrNeverLabel,
  archivedThreadItems,
  focusContextSidebarItems,
  focusDrawerAdapter,
  focusScopeEditorModel,
  threadDrawerAdapter,
  threadWorkingContextModel,
  threadSidebarItemId
} from '@/features/focus/focus-presenters'
import { isVisibleThread } from '@/features/focus/focus-utils'
import { ThreadArchiveDialog } from '@/features/focus/thread-archive-dialog'
import { useCommitmentWorkingContextModel } from '@/features/focus/use-commitment-working-context-model'
import { useFocusWorkspaceModel } from '@/features/focus/use-focus-workspace-model'
import { WorkStatusSelect } from '@/features/shared/work-status-select'
import { WorkDueDateField } from '@/features/shared/work-due-date-field'
import { visibleSensitiveRecords } from '@/features/shared/sensitivity'
import { SensitivityToggle } from '@/features/shared/sensitivity-toggle'
import { DirectTodos } from '@/features/todos/direct-todos'
import { DirectUpdates } from '@/features/updates/direct-updates'
import { NoteSplitWorkspace } from '@/features/notes/note-split-workspace'
import {
  RoutineEditor,
  RoutineEditorDialog,
  type RoutineEditorParent
} from '@/features/routines/routine-editor-dialog'
import { RoutineHistory } from '@/features/routines/routine-history'
import { RoutineManagementList } from '@/features/routines/routine-management-list'
import {
  routineDrawerAdapter,
  routineHistoryModel,
  routineManagementListModel,
  routineWorkingContextModel
} from '@/features/routines/routine-presenters'

const CONTEXTUAL_SIDEBAR_MIN = 220
const CONTEXTUAL_SIDEBAR_MAX = 320

function contextItemIdForCommitmentParent(parent: CommitmentParent): string {
  return parent.type === 'focus' ? 'overall' : threadSidebarItemId(parent.id)
}

function defaultNote(notes: FocusSnapshot['notes']): FocusSnapshot['notes'][number] | null {
  return notes.find(({ title }) => title === 'Default') ?? null
}

function commitmentParentForContextItem(
  itemId: string,
  focusId: number
): CommitmentParent | null {
  if (itemId === 'overall') return { type: 'focus', id: focusId }
  if (!itemId.startsWith('thread:')) return null
  const threadId = Number(itemId.slice('thread:'.length))
  return Number.isInteger(threadId) && threadId > 0
    ? { type: 'thread', id: threadId }
    : null
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
          <TaggedInput
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

interface FocusWorkspaceProps {
  focus: FocusSnapshot
  contextDrawer: ContextDrawerControl
  onUpdateFocus: (input: UpdateFocusInput) => Promise<void>
  onRefreshFocus: () => Promise<FocusSnapshot>
  onRefreshStatusSummary: () => Promise<void>
  onDeleteFocus: () => Promise<void>
  selectedSubjectId: number | null
  onSelectedSubjectChange: (subjectId: number | null) => void
  destination?: FocusWorkspaceDestination | null
  onDestinationApplied?: (requestId: number) => void
  hideSensitiveContent?: boolean
  threadMoveTargets: readonly { id: number; title: string }[]
  onThreadMoved: (thread: ThreadSnapshot, fromFocusId: number) => void | Promise<void>
}

export function FocusWorkspace({
  focus,
  contextDrawer,
  onUpdateFocus,
  onRefreshFocus,
  onRefreshStatusSummary,
  onDeleteFocus,
  selectedSubjectId,
  onSelectedSubjectChange,
  destination = null,
  onDestinationApplied,
  hideSensitiveContent = false,
  threadMoveTargets,
  onThreadMoved
}: FocusWorkspaceProps): React.JSX.Element {
  const model = useFocusWorkspaceModel({ focus })
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  const [newCommitmentParent, setNewCommitmentParent] =
    useState<CommitmentParent | null>(null)
  const [newRoutineParent, setNewRoutineParent] = useState<CommitmentParent | null>(null)
  const [editingRoutineId, setEditingRoutineId] = useState<number | null>(null)
  const [routineSaving, setRoutineSaving] = useState(false)
  const [contextualSidebarWidth, setContextualSidebarWidth] = useState(252)
  const [commitmentStatusSavingId, setCommitmentStatusSavingId] = useState<number | null>(null)
  const [commitmentStatusError, setCommitmentStatusError] = useState<{
    id: number
    message: string
  } | null>(null)
  const [workspaceStatusSavingKey, setWorkspaceStatusSavingKey] = useState<string | null>(null)
  const [workspaceStatusError, setWorkspaceStatusError] = useState<{
    key: string
    message: string
  } | null>(null)
  const [threadArchiveOpen, setThreadArchiveOpen] = useState(false)
  const [restoringThreadId, setRestoringThreadId] = useState<number | null>(null)
  const [threadArchiveError, setThreadArchiveError] = useState<string | null>(null)
  const [pendingCommitmentMove, setPendingCommitmentMove] = useState<{
    plan: CommitmentMovePlanSnapshot
    commitmentTitle: string
    targetLabel: string
  } | null>(null)
  const [commitmentMoveSaving, setCommitmentMoveSaving] = useState(false)
  const [commitmentMoveError, setCommitmentMoveError] = useState<string | null>(null)
  const [routineMoveError, setRoutineMoveError] = useState<string | null>(null)
  const [standaloneCommitmentRoute, setStandaloneCommitmentRoute] = useState<{
    parent: CommitmentParent
    commitmentId: number
  } | null>(null)
  const [pendingThreadMove, setPendingThreadMove] = useState<{
    plan: ThreadMovePlanSnapshot
    threadTitle: string
    targetTitle: string
  } | null>(null)
  const [threadMoveSaving, setThreadMoveSaving] = useState(false)
  const [threadMoveError, setThreadMoveError] = useState<string | null>(null)
  const threadMoveRequest = useRef<(move: ContextualSidebarItemMove) => void>(
    () => undefined
  )
  const childMoveRequest = useRef<(move: ContextualSidebarChildMove) => void>(
    () => undefined
  )
  const commitmentMoveExecution = useRef<(
    plan: CommitmentMovePlanSnapshot,
    confirmedScopeSubjectIds?: readonly number[]
  ) => Promise<void>>(async () => undefined)
  const commitmentAdapterFactory = useRef<(
    commitment: CommitmentSnapshot
  ) => ContextDrawerAdapter>(() => {
    throw new Error('Commitment drawer adapter is not ready.')
  })
  const threadAdapterFactory = useRef<(
    thread: ThreadSnapshot
  ) => ContextDrawerAdapter>(() => {
    throw new Error('Thread drawer adapter is not ready.')
  })
  const [focusLevel] = useState(
    () =>
      new ContextualSidebarLevel({
        id: `focus:${focus.id}`,
        title: 'Focus',
        ariaLabel: 'Focus sections',
        items: focusContextSidebarItems(
          [],
          {},
          false,
          { overall: [] },
          { overall: [] }
        ),
        onSelect: () => setStandaloneCommitmentRoute(null),
        onSelectChild: () => setStandaloneCommitmentRoute(null),
        onChildCollectionAction: (parentItemId, collectionId, actionId) => {
          if (collectionId !== 'commitments') return
          const parent = commitmentParentForContextItem(parentItemId, focus.id)
          if (!parent) return
          if (actionId === 'add-commitment') setNewCommitmentParent(parent)
          if (actionId === 'add-routine') setNewRoutineParent(parent)
        },
        canMoveChild: ({ sourceCollectionId, targetCollectionId }) =>
          sourceCollectionId === 'commitments' && targetCollectionId === 'commitments',
        onMoveChild: (move) => childMoveRequest.current(move),
        itemMoveTargetType: 'focus',
        canMoveItem: ({ itemId, targetId }) =>
          itemId.startsWith('thread:') && Number(targetId) !== focus.id,
        onMoveItem: (move) => threadMoveRequest.current(move),
        newItem: {
          label: 'New thread',
          onCreate: () => setNewThreadOpen(true)
        },
        footerActions: [{
          id: 'archive',
          label: 'Archive',
          ariaLabel: 'Open archived threads',
          icon: 'archive',
          onInvoke: () => {
            setThreadArchiveError(null)
            setThreadArchiveOpen(true)
          }
        }]
      })
  )

  const [focusCommitmentsLevel] = useState(
    () =>
      new ContextualSidebarLevel({
        id: `focus:${focus.id}:commitments`,
        title: 'Commitments',
        ariaLabel: 'Focus commitments',
        parent: focusLevel,
        parentItemId: 'overall',
        items: [],
        onSelect: () => setStandaloneCommitmentRoute(null),
        newItem: {
          label: 'New commitment',
          onCreate: () => setNewCommitmentParent({ type: 'focus', id: focus.id })
        }
      })
  )
  const [threadCommitmentLevels] = useState(
    () => new Map<number, ContextualSidebarLevel>()
  )

  const [navigation] = useState(
    () => new ContextualSidebarNavigation(focusLevel)
  )
  const navigationSnapshot = useContextualSidebarNavigation(navigation)
  const appliedDestinationRequest = useRef<number | null>(null)

  const visibleThreadRecords = useMemo<readonly ThreadSnapshot[]>(
    () => visibleSensitiveRecords(
      model.threads.filter(isVisibleThread),
      hideSensitiveContent,
      focus.sensitive
    ),
    [focus.sensitive, hideSensitiveContent, model.threads]
  )
  const archivedThreads = useMemo(
    () => archivedThreadItems(visibleSensitiveRecords(
      model.threads.filter((thread) => !isVisibleThread(thread)),
      hideSensitiveContent,
      focus.sensitive
    )),
    [focus.sensitive, hideSensitiveContent, model.threads]
  )
  const visibleFocusCommitments = useMemo(
    () => visibleSensitiveRecords(
      model.commitments,
      hideSensitiveContent,
      focus.sensitive
    ),
    [focus.sensitive, hideSensitiveContent, model.commitments]
  )
  const visibleThreadCommitments = useMemo(
    () => Object.fromEntries(
      Object.entries(model.threadCommitments).map(([threadId, commitments]) => {
        const threadSensitive =
          model.threads.find((thread) => thread.id === Number(threadId))?.sensitive ?? true
        return [
          threadId,
          visibleSensitiveRecords(
            commitments ?? [],
            hideSensitiveContent,
            focus.sensitive || threadSensitive
          )
        ]
      })
    ) as Readonly<Record<number, readonly CommitmentSnapshot[] | undefined>>,
    [focus.sensitive, hideSensitiveContent, model.threadCommitments, model.threads]
  )
  const commitmentsByContextItemId = useMemo(
    () => ({
      overall: visibleFocusCommitments,
      ...Object.fromEntries(
        visibleThreadRecords.map((thread) => [
          threadSidebarItemId(thread.id),
          visibleThreadCommitments[thread.id] ?? []
        ])
      )
    }),
    [visibleFocusCommitments, visibleThreadCommitments, visibleThreadRecords]
  )
  const routinesByContextItemId = useMemo<
    Readonly<Record<string, readonly RoutineSnapshot[]>>
  >(
    () => ({
      overall: visibleSensitiveRecords(
        model.routines.filter((routine) =>
          routine.parent.type === 'focus' && routine.parent.id === focus.id
        ),
        hideSensitiveContent,
        focus.sensitive
      ),
      ...Object.fromEntries(
        visibleThreadRecords.map((thread) => [
          threadSidebarItemId(thread.id),
          visibleSensitiveRecords(
            model.routines.filter((routine) =>
              routine.parent.type === 'thread' && routine.parent.id === thread.id
            ),
            hideSensitiveContent,
            focus.sensitive || thread.sensitive
          )
        ])
      )
    }),
    [
      focus.id,
      focus.sensitive,
      hideSensitiveContent,
      model.routines,
      visibleThreadRecords
    ]
  )

  function parentIsSensitive(parent: CommitmentParent): boolean {
    if (focus.sensitive) return true
    if (parent.type === 'focus') return false
    return model.threads.find((thread) => thread.id === parent.id)?.sensitive ?? true
  }

  function visibleCommitmentsFor(
    parent: CommitmentParent
  ): readonly CommitmentSnapshot[] {
    return parent.type === 'focus'
      ? visibleFocusCommitments
      : (visibleThreadCommitments[parent.id] ?? [])
  }

  function allCommitments(): CommitmentSnapshot[] {
    return [
      ...model.commitments,
      ...Object.values(model.threadCommitments).flatMap((items) => items ?? [])
    ]
  }

  function commitmentParentLabel(parent: CommitmentParent): string {
    if (parent.type === 'focus') return 'Overall'
    return model.threads.find(({ id }) => id === parent.id)?.title ?? 'Thread'
  }

  async function requestCommitmentMove(move: ContextualSidebarChildMove): Promise<void> {
    const target = commitmentParentForContextItem(move.targetParentItemId, focus.id)
    const commitmentId = Number(move.childItemId)
    const commitment = allCommitments().find(({ id }) => id === commitmentId)
    if (!target || !commitment || move.sourceCollectionId !== 'commitments') return
    setCommitmentMoveError(null)
    try {
      const plan = await model.planCommitmentMove(commitmentId, target)
      if (plan.requiresConfirmation) {
        setPendingCommitmentMove({
          plan,
          commitmentTitle: commitment.title,
          targetLabel: commitmentParentLabel(target)
        })
        return
      }
      await commitmentMoveExecution.current(plan)
    } catch {
      setCommitmentMoveError('The Commitment could not be moved.')
    }
  }

  async function requestRoutineMove(move: ContextualSidebarChildMove): Promise<void> {
    const target = commitmentParentForContextItem(move.targetParentItemId, focus.id)
    if (
      !target ||
      move.sourceCollectionId !== 'commitments' ||
      !move.childItemId.startsWith('routine:')
    ) return
    const routineId = Number(move.childItemId.slice('routine:'.length))
    const routine = model.routines.find(({ id }) => id === routineId)
    if (!routine) return
    setRoutineMoveError(null)
    try {
      const plan = await model.planRoutineMove(routineId, target)
      const moved = await model.moveRoutine(routineId, {
        parent: plan.to,
        plannedFrom: plan.from
      })
      updateSidebarForMovedRoutine(moved)
    } catch {
      setRoutineMoveError('The Routine could not be moved.')
    }
  }

  function requestChildMove(move: ContextualSidebarChildMove): void {
    if (move.childItemId.startsWith('routine:')) {
      void requestRoutineMove(move)
      return
    }
    void requestCommitmentMove(move)
  }

  async function requestThreadMove(move: ContextualSidebarItemMove): Promise<void> {
    if (!move.itemId.startsWith('thread:') || move.targetType !== 'focus') return
    const threadId = Number(move.itemId.slice('thread:'.length))
    const targetFocusId = Number(move.targetId)
    const thread = model.threads.find((candidate) => candidate.id === threadId)
    const target = threadMoveTargets.find((candidate) => candidate.id === targetFocusId)
    if (!thread || !target || targetFocusId === focus.id) return
    setThreadMoveError(null)
    try {
      const plan = await model.planThreadMove(threadId, targetFocusId)
      if (plan.requiresConfirmation) {
        setPendingThreadMove({
          plan,
          threadTitle: thread.title,
          targetTitle: target.title
        })
        return
      }
      await executeThreadMove(plan)
    } catch {
      setThreadMoveError('The Thread could not be moved.')
    }
  }

  async function executeThreadMove(
    plan: ThreadMovePlanSnapshot,
    confirmedScopeSubjectIds: readonly number[] = []
  ): Promise<void> {
    setThreadMoveSaving(true)
    setThreadMoveError(null)
    try {
      const moved = await model.moveThread(plan.threadId, {
        focusId: plan.toFocusId,
        plannedFromFocusId: plan.fromFocusId,
        confirmedScopeSubjectIds
      })
      setPendingThreadMove(null)
      await onThreadMoved(moved, plan.fromFocusId)
    } catch {
      setThreadMoveError('The Thread could not be moved.')
    } finally {
      setThreadMoveSaving(false)
    }
  }

  function updateSidebarForMovedCommitment(moved: CommitmentSnapshot): void {
    const nextByContext = Object.fromEntries(
      Object.entries(commitmentsByContextItemId).map(([itemId, commitments]) => [
        itemId,
        (commitments ?? []).filter(({ id }) => id !== moved.id)
      ])
    ) as Record<string, CommitmentSnapshot[]>
    const targetItemId = contextItemIdForCommitmentParent(moved.parent)
    nextByContext[targetItemId] = [...(nextByContext[targetItemId] ?? []), moved]
    focusLevel.setItems(focusContextSidebarItems(
      visibleThreadRecords,
      model.threadStatusSummaries,
      hideSensitiveContent,
      nextByContext,
      routinesByContextItemId
    ))
    navigation.refresh()
    navigation.selectChild(targetItemId, 'commitments', String(moved.id))
  }

  function updateSidebarForMovedRoutine(moved: RoutineSnapshot): void {
    const nextByContext = Object.fromEntries(
      Object.entries(routinesByContextItemId).map(([itemId, routines]) => [
        itemId,
        (routines ?? []).filter(({ id }) => id !== moved.id)
      ])
    ) as Record<string, RoutineSnapshot[]>
    const targetItemId = contextItemIdForCommitmentParent(moved.parent)
    nextByContext[targetItemId] = [...(nextByContext[targetItemId] ?? []), moved]
    focusLevel.setItems(focusContextSidebarItems(
      visibleThreadRecords,
      model.threadStatusSummaries,
      hideSensitiveContent,
      commitmentsByContextItemId,
      nextByContext
    ))
    navigation.refresh()
    navigation.selectChild(targetItemId, 'commitments', `routine:${moved.id}`)
  }

  async function executeCommitmentMove(
    plan: CommitmentMovePlanSnapshot,
    confirmedScopeSubjectIds: readonly number[] = []
  ): Promise<void> {
    setCommitmentMoveSaving(true)
    setCommitmentMoveError(null)
    try {
      const moved = await model.moveCommitment(plan.commitmentId, {
        parent: plan.to,
        confirmedScopeSubjectIds
      })
      updateSidebarForMovedCommitment(moved)
      if (contextDrawer.pinnedAdapter?.id === `commitment:${moved.id}`) {
        contextDrawer.onPin(commitmentAdapterFactory.current(moved))
      }
      setPendingCommitmentMove(null)
      try {
        await onRefreshStatusSummary()
      } catch {
        // The transactional move and refreshed workspace are authoritative; a
        // later aggregate refresh can repair a stale primary-sidebar summary.
      }
    } catch {
      setCommitmentMoveError('The Commitment could not be moved.')
    } finally {
      setCommitmentMoveSaving(false)
    }
  }

  useEffect(() => {
    childMoveRequest.current = requestChildMove
    commitmentMoveExecution.current = executeCommitmentMove
    threadMoveRequest.current = (move) => void requestThreadMove(move)
  })

  function commitmentsLevelFor(parent: CommitmentParent): ContextualSidebarLevel {
    if (parent.type === 'focus') return focusCommitmentsLevel

    const existing = threadCommitmentLevels.get(parent.id)
    if (existing) return existing

    const created = new ContextualSidebarLevel({
      id: `thread:${parent.id}:commitments`,
      title: 'Commitments',
      ariaLabel: 'Thread commitments',
      parent: focusLevel,
      parentItemId: threadSidebarItemId(parent.id),
      items: commitmentContextSidebarItems(visibleCommitmentsFor(parent)),
      onSelect: () => setStandaloneCommitmentRoute(null),
      newItem: {
        label: 'New commitment',
        onCreate: () => setNewCommitmentParent(parent)
      }
    })
    threadCommitmentLevels.set(parent.id, created)
    return created
  }

  function commitmentParentForLevel(
    level: ContextualSidebarLevel
  ): CommitmentParent | null {
    if (level === focusCommitmentsLevel) return { type: 'focus', id: focus.id }
    for (const [threadId, candidate] of threadCommitmentLevels) {
      if (candidate === level) return { type: 'thread', id: threadId }
    }
    return null
  }

  useEffect(() => {
    focusLevel.setItems(
      focusContextSidebarItems(
        visibleThreadRecords,
        model.threadStatusSummaries,
        hideSensitiveContent,
        commitmentsByContextItemId,
        routinesByContextItemId
      )
    )
    focusCommitmentsLevel.setItems(
      commitmentContextSidebarItems(
        visibleFocusCommitments
      )
    )
    for (const [threadId, level] of threadCommitmentLevels) {
      level.setItems(
        commitmentContextSidebarItems(
          visibleThreadCommitments[threadId] ?? []
        )
      )
    }
    navigation.refresh()
  }, [
    focusCommitmentsLevel,
    focusLevel,
    model.commitments,
    model.threadCommitments,
    model.threads,
    model.threadStatusSummaries,
    commitmentsByContextItemId,
    routinesByContextItemId,
    visibleFocusCommitments,
    visibleThreadCommitments,
    visibleThreadRecords,
    hideSensitiveContent,
    navigation,
    threadCommitmentLevels
  ])

  useEffect(() => {
    if (
      !destination ||
      destination.focusId !== focus.id ||
      appliedDestinationRequest.current === destination.requestId
    ) return

    const thread = destination.threadId === null
      ? null
      : visibleThreadRecords.find(({ id }) => id === destination.threadId)
    if (destination.threadId !== null && !thread) return

    const parent: CommitmentParent = thread
      ? { type: 'thread', id: thread.id }
      : { type: 'focus', id: focus.id }
    if (destination.commitmentId !== null) {
      const parentCommitments = parent.type === 'focus'
        ? visibleFocusCommitments
        : (visibleThreadCommitments[parent.id] ?? [])
      const commitment = parentCommitments.find(
        ({ id }) => id === destination.commitmentId
      )
      if (!commitment) return
    }

    navigation.reset()
    const parentItemId = contextItemIdForCommitmentParent(parent)
    if (destination.commitmentId === null) {
      navigation.select(parentItemId)
    } else {
      const destinationCommitmentId = destination.commitmentId
      const currentCommitment = buildCommitmentListModel(
        parent.type === 'focus'
          ? visibleFocusCommitments
          : (visibleThreadCommitments[parent.id] ?? [])
      ).current.some(({ id }) => id === destinationCommitmentId)
      if (currentCommitment) {
        navigation.selectChild(
          parentItemId,
          'commitments',
          String(destinationCommitmentId)
        )
      } else {
        navigation.select(parentItemId)
        queueMicrotask(() => {
          setStandaloneCommitmentRoute({
            parent,
            commitmentId: destinationCommitmentId
          })
        })
      }
    }
    onSelectedSubjectChange(destination.subjectId)
    appliedDestinationRequest.current = destination.requestId
    onDestinationApplied?.(destination.requestId)
  }, [
    destination,
    focus.id,
    navigation,
    onDestinationApplied,
    onSelectedSubjectChange,
    visibleFocusCommitments,
    visibleThreadCommitments,
    visibleThreadRecords
  ])

  const rawSelectedThread =
    navigationSnapshot.level === focusLevel && navigationSnapshot.selectedItemId
      ? model.threads.find(
          (thread) => threadSidebarItemId(thread.id) === navigationSnapshot.selectedItemId
        )
      : undefined
  const selectedThread = rawSelectedThread &&
    visibleThreadRecords.some((thread) => thread.id === rawSelectedThread.id)
      ? rawSelectedThread
      : undefined
  const levelCommitmentParent = commitmentParentForLevel(
    navigationSnapshot.level as ContextualSidebarLevel
  )
  const childCommitmentParent =
    navigationSnapshot.level === focusLevel &&
    navigationSnapshot.selectedChild &&
    !navigationSnapshot.selectedChild.childItemId.startsWith('routine:')
      ? commitmentParentForContextItem(
          navigationSnapshot.selectedChild.parentItemId,
          focus.id
        )
      : null
  const childRoutineParent =
    navigationSnapshot.level === focusLevel &&
    navigationSnapshot.selectedChild?.childItemId.startsWith('routine:')
      ? commitmentParentForContextItem(
          navigationSnapshot.selectedChild.parentItemId,
          focus.id
        )
      : null
  const selectedRoutineId = childRoutineParent && navigationSnapshot.selectedChild
    ? Number(navigationSnapshot.selectedChild.childItemId.slice('routine:'.length))
    : null
  const selectedRoutine = childRoutineParent && selectedRoutineId !== null
    ? (routinesByContextItemId[
        contextItemIdForCommitmentParent(childRoutineParent)
      ] ?? []).find(({ id }) => id === selectedRoutineId)
    : undefined
  const activeCommitmentParent = standaloneCommitmentRoute?.parent ??
    childCommitmentParent ??
    levelCommitmentParent
  const commitmentRouteFromChild = standaloneCommitmentRoute === null &&
    childCommitmentParent !== null
  const rawActiveCommitments = activeCommitmentParent
    ? model.commitmentsFor(activeCommitmentParent)
    : []
  const activeCommitments = activeCommitmentParent
    ? visibleCommitmentsFor(activeCommitmentParent)
    : []
  const routedCommitmentId = standaloneCommitmentRoute
    ? String(standaloneCommitmentRoute.commitmentId)
    : commitmentRouteFromChild
      ? navigationSnapshot.selectedChild?.childItemId
      : navigationSnapshot.selectedItemId
  const rawSelectedCommitment =
    activeCommitmentParent && routedCommitmentId
      ? rawActiveCommitments.find(
          (commitment) => String(commitment.id) === routedCommitmentId
        )
      : undefined
  const selectedCommitment = rawSelectedCommitment &&
    activeCommitments.some((commitment) => commitment.id === rawSelectedCommitment.id)
      ? rawSelectedCommitment
      : undefined
  const activeParentThread = activeCommitmentParent?.type === 'thread'
    ? model.threads.find((thread) => thread.id === activeCommitmentParent.id)
    : undefined
  const commitmentRouteHiddenByAncestor =
    hideSensitiveContent && parentIsSensitive(activeCommitmentParent ?? { type: 'focus', id: focus.id })
  const commitmentRouteHiddenBySelection =
    hideSensitiveContent && rawSelectedCommitment?.sensitive === true
  const commitmentRouteHidden =
    activeCommitmentParent !== null &&
    (commitmentRouteHiddenByAncestor || commitmentRouteHiddenBySelection)
  const displayedThread = selectedThread ?? (
    commitmentRouteHiddenBySelection && !commitmentRouteHiddenByAncestor
      ? activeParentThread
      : undefined
  )
  const focusTitle = focus.title
  function editorParentFor(parent: CommitmentParent): RoutineEditorParent | null {
    return parent.type === 'focus'
      ? {
          parent,
          label: focus.title,
          scope: model.focusScope?.scopeId
            ? { id: model.focusScope.scopeId, name: 'Focus scope' }
            : null
        }
      : (() => {
          const thread = model.threads.find(({ id }) => id === parent.id)
          const scope = model.threadScopes[parent.id]
          return thread
            ? {
                parent,
                label: `${focus.title} / ${thread.title}`,
                scope: scope?.scopeId
                  ? {
                      id: scope.scopeId,
                      name: scope.mode === 'inherited' ? 'Inherited scope' : 'Thread scope'
                    }
                  : null
              }
            : null
        })()
  }
  const newRoutineEditorParent = newRoutineParent
    ? editorParentFor(newRoutineParent)
    : null
  const selectedRoutineEditorParent = selectedRoutine
    ? editorParentFor(selectedRoutine.parent)
    : null
  const commitmentWorkingContext = useCommitmentWorkingContextModel(
    selectedCommitment?.id ?? null
  )
  const displayedThreadScope = displayedThread
    ? model.threadScopes[displayedThread.id]
    : undefined
  const displayedThreadSubjectMatrix = displayedThread
    ? model.threadSubjectMatrices[displayedThread.id]
    : undefined
  const selectedThreadSubject: SubjectSnapshot | null =
    displayedThreadScope?.subjects.find(({ id }) => id === selectedSubjectId) ?? null
  const selectedThreadSubjectCell: ThreadSubjectCellSnapshot | null =
    displayedThreadSubjectMatrix?.find(
      ({ subjectId }) => subjectId === selectedThreadSubject?.id
    ) ?? null
  const threadContextTabs = displayedThreadScope && displayedThreadSubjectMatrix
    ? threadWorkingContextModel(displayedThreadScope, displayedThreadSubjectMatrix)
    : null
  const selectedCommitmentCell = commitmentWorkingContext.snapshot?.cells.find(
    ({ subjectId }) => subjectId === selectedSubjectId
  ) ?? null
  const commitmentContextTabs = commitmentWorkingContext.snapshot
    ? commitmentWorkingContextModel(commitmentWorkingContext.snapshot)
    : null
  const routineSubjectCells = useMemo(
    () => (selectedRoutine?.currentRun?.cells ?? []).filter((cell) => cell.subject !== null),
    [selectedRoutine]
  )
  const selectedRoutineSubjectCell = routineSubjectCells.find(
    (cell) => cell.subject?.id === selectedSubjectId
  ) ?? null
  const selectedRoutineSubjectId = selectedRoutineSubjectCell?.subject?.id ?? null
  const routineContextTabs = selectedRoutine
    ? routineWorkingContextModel(selectedRoutine)
    : null

  useEffect(() => {
    if (!selectedRoutine) return
    const firstSubjectId = routineSubjectCells[0]?.subject?.id ?? null
    if (firstSubjectId === null) {
      if (selectedSubjectId !== null) onSelectedSubjectChange(null)
      return
    }
    if (selectedRoutineSubjectCell === null) onSelectedSubjectChange(firstSubjectId)
  }, [
    onSelectedSubjectChange,
    routineSubjectCells,
    selectedRoutine,
    selectedRoutineSubjectCell,
    selectedSubjectId
  ])

  useEffect(() => {
    if (selectedSubjectId === null) return
    if (
      displayedThread &&
      displayedThreadScope &&
      displayedThreadSubjectMatrix &&
      selectedThreadSubject === null
    ) {
      onSelectedSubjectChange(null)
      return
    }
    if (
      selectedCommitment &&
      commitmentWorkingContext.snapshot &&
      selectedCommitmentCell === null
    ) onSelectedSubjectChange(null)
  }, [
    commitmentWorkingContext.snapshot,
    displayedThread,
    displayedThreadScope,
    displayedThreadSubjectMatrix,
    onSelectedSubjectChange,
    selectedCommitment,
    selectedCommitmentCell,
    selectedSubjectId,
    selectedThreadSubject
  ])

  function selectCommitmentContext(tabId: string): void {
    if (!selectedCommitment) return
    if (tabId === 'all') {
      onSelectedSubjectChange(null)
      return
    }
    const subjectId = Number(tabId.slice('subject:'.length))
    if (
      tabId.startsWith('subject:') &&
      Number.isInteger(subjectId) &&
      commitmentWorkingContext.snapshot?.cells.some(
        (cell) => cell.subjectId === subjectId
      )
    ) {
      onSelectedSubjectChange(subjectId)
    }
  }

  function selectThreadContext(tabId: string): void {
    if (!displayedThread) return
    if (tabId === 'all') {
      onSelectedSubjectChange(null)
      return
    }
    const subjectId = Number(tabId.slice('subject:'.length))
    if (
      tabId.startsWith('subject:') &&
      Number.isInteger(subjectId) &&
      displayedThreadScope?.subjects.some(({ id }) => id === subjectId)
    ) {
      onSelectedSubjectChange(subjectId)
    }
  }

  function selectRoutineContext(tabId: string): void {
    if (!selectedRoutine || !tabId.startsWith('subject:')) return
    const subjectId = Number(tabId.slice('subject:'.length))
    if (
      Number.isInteger(subjectId) &&
      routineSubjectCells.some((cell) => cell.subject?.id === subjectId)
    ) onSelectedSubjectChange(subjectId)
  }

  useEffect(() => {
    if (!hideSensitiveContent) return
    if (commitmentRouteHiddenByAncestor) {
      if (standaloneCommitmentRoute && activeCommitmentParent) {
        navigation.select(
          activeCommitmentParent.type === 'thread' && activeParentThread?.sensitive
            ? 'overall'
            : contextItemIdForCommitmentParent(activeCommitmentParent)
        )
        return
      }
      if (commitmentRouteFromChild && activeCommitmentParent) {
        const parentItemId = contextItemIdForCommitmentParent(activeCommitmentParent)
        navigation.select(
          activeCommitmentParent.type === 'thread' && activeParentThread?.sensitive
            ? 'overall'
            : parentItemId
        )
      } else {
        navigation.reset()
      }
      return
    }
    if (commitmentRouteHiddenBySelection) {
      if (standaloneCommitmentRoute && activeCommitmentParent) {
        navigation.select(contextItemIdForCommitmentParent(activeCommitmentParent))
        return
      }
      if (commitmentRouteFromChild && activeCommitmentParent) {
        navigation.select(contextItemIdForCommitmentParent(activeCommitmentParent))
      } else {
        navigation.back()
      }
      return
    }
    if (rawSelectedThread?.sensitive) navigation.select('overall')
  }, [
    commitmentRouteHiddenByAncestor,
    commitmentRouteHiddenBySelection,
    commitmentRouteFromChild,
    hideSensitiveContent,
    navigation,
    rawSelectedThread,
    activeCommitmentParent,
    activeParentThread,
    standaloneCommitmentRoute
  ])

  function adapterForCommitment(commitment: CommitmentSnapshot): ContextDrawerAdapter {
    if (commitment.parent.type === 'focus') {
      return commitmentDrawerAdapter({
        commitment,
        parentTitle: focusTitle,
        ancestorKeys: [`focus:${focus.id}`],
        onSave: (input) => saveCommitmentFromDrawer(commitment.id, input),
        onDelete: () => deleteCommitmentFromDrawer(commitment)
      })
    }
    const thread = model.threads.find(
      (candidate) => candidate.id === commitment.parent.id
    )
    return commitmentDrawerAdapter({
      commitment,
      parentTitle: thread?.title ?? 'Thread',
      ancestorKeys: [`focus:${focus.id}`, `thread:${commitment.parent.id}`],
      onSave: (input) => saveCommitmentFromDrawer(commitment.id, input),
      onDelete: () => deleteCommitmentFromDrawer(commitment)
    })
  }

  function adapterForThread(
    thread: ThreadSnapshot,
    scope = model.threadScopes[thread.id]
  ): ContextDrawerAdapter {
    async function mutateScope(
      operation: () => Promise<ThreadScopeSnapshot>
    ): Promise<void> {
      const nextScope = await operation()
      if (
        selectedSubjectId !== null &&
        !nextScope.subjects.some(({ id }) => id === selectedSubjectId)
      ) onSelectedSubjectChange(null)
      if (contextDrawer.pinnedAdapter?.id === `thread:${thread.id}`) {
        contextDrawer.onPin(adapterForThread(thread, nextScope))
      }
    }

    return threadDrawerAdapter({
      thread,
      parentTitle: focusTitle,
      onSave: (input) => saveThreadFromDrawer(thread.id, input),
      onDelete: () => deleteThreadFromDrawer(thread.id),
      scopeEditor: scope ? {
        scope,
        onCustomize: () => mutateScope(() => model.customizeThreadScope(thread.id)),
        onFollowFocus: () => mutateScope(() => model.followFocusThreadScope(thread.id)),
        onAddSubject: (name) =>
          mutateScope(() => model.addThreadScopeSubject(thread.id, name)),
        onRemoveSubject: (subjectId) =>
          mutateScope(() => model.removeThreadScopeSubject(thread.id, subjectId))
      } : undefined
    })
  }

  async function saveThreadFromDrawer(
    threadId: number,
    input: UpdateThreadInput
  ): Promise<void> {
    const updated = await model.updateThread(threadId, input)
    if (contextDrawer.pinnedAdapter?.id === `thread:${threadId}`) {
      contextDrawer.onPin(adapterForThread(updated))
    }
  }

  async function saveCommitmentFromDrawer(
    commitmentId: number,
    input: UpdateCommitmentInput
  ): Promise<void> {
    const updated = await model.updateCommitment(commitmentId, input)
    await onRefreshStatusSummary()
    if (contextDrawer.pinnedAdapter?.id === `commitment:${commitmentId}`) {
      contextDrawer.onPin(adapterForCommitment(updated))
    }
  }

  function currentRouteUsesThread(threadId: number): boolean {
    const snapshot = navigation.getSnapshot()
    const itemId = threadSidebarItemId(threadId)
    return snapshot.selectedItemId === itemId ||
      snapshot.selectedChild?.parentItemId === itemId ||
      snapshot.level.id === `thread:${threadId}:commitments` ||
      (standaloneCommitmentRoute?.parent.type === 'thread' &&
        standaloneCommitmentRoute.parent.id === threadId)
  }

  async function deleteThreadFromDrawer(threadId: number): Promise<void> {
    const routeUsesThread = currentRouteUsesThread(threadId)
    const deleted = await model.deleteThread(threadId)
    if (!deleted) throw new Error('Thread deletion did not remove a record.')

    contextDrawer.onInvalidate([`thread:${threadId}`])
    if (routeUsesThread) {
      setStandaloneCommitmentRoute(null)
      navigation.reset()
      navigation.select('overall')
    }
    try {
      await onRefreshStatusSummary()
    } catch {
      // The record is already deleted and local collections are authoritative;
      // a later refresh can repair a stale aggregate summary.
    }
  }

  async function deleteCommitmentFromDrawer(
    commitment: CommitmentSnapshot
  ): Promise<void> {
    const snapshot = navigation.getSnapshot()
    const commitmentId = String(commitment.id)
    const selectedAsChild = snapshot.selectedChild?.childItemId === commitmentId
    const selectedInLevel = snapshot.level !== focusLevel &&
      snapshot.selectedItemId === commitmentId
    const selectedStandalone = standaloneCommitmentRoute?.commitmentId === commitment.id
    const deleted = await model.deleteCommitment(commitment.id)
    if (!deleted) throw new Error('Commitment deletion did not remove a record.')

    contextDrawer.onInvalidate([`commitment:${commitment.id}`])
    if (selectedAsChild) {
      navigation.select(contextItemIdForCommitmentParent(commitment.parent))
    } else if (selectedInLevel) {
      navigation.back()
    } else if (selectedStandalone) {
      setStandaloneCommitmentRoute(null)
      navigation.select(contextItemIdForCommitmentParent(commitment.parent))
    }
    try {
      await onRefreshStatusSummary()
    } catch {
      // The record is already deleted and local collections are authoritative;
      // a later refresh can repair a stale aggregate summary.
    }
  }

  useEffect(() => {
    commitmentAdapterFactory.current = adapterForCommitment
    threadAdapterFactory.current = adapterForThread
  })

  useEffect(() => {
    const pinned = contextDrawer.pinnedAdapter
    if (!pinned || pinned.invalidationKeys.includes(`focus:${focus.id}`)) return
    if (pinned.id.startsWith('thread:')) {
      const threadId = Number(pinned.id.slice('thread:'.length))
      const thread = model.threads.find((candidate) => candidate.id === threadId)
      if (thread) contextDrawer.onPin(threadAdapterFactory.current(thread))
      return
    }
    if (pinned.id.startsWith('commitment:')) {
      const commitmentId = Number(pinned.id.slice('commitment:'.length))
      const commitment = [
        ...model.commitments,
        ...Object.values(model.threadCommitments).flatMap((items) => items ?? [])
      ].find((candidate) => candidate.id === commitmentId)
      if (commitment) contextDrawer.onPin(commitmentAdapterFactory.current(commitment))
    }
  }, [contextDrawer, focus.id, model.commitments, model.threadCommitments, model.threads])

  const contextDrawerAdapter: ContextDrawerAdapter | null = selectedRoutine
    ? routineDrawerAdapter({
        routine: selectedRoutine,
        parentLabel: commitmentParentLabel(selectedRoutine.parent),
        ancestorKeys: [
          `focus:${focus.id}`,
          ...(selectedRoutine.parent.type === 'thread'
            ? [`thread:${selectedRoutine.parent.id}`]
            : [])
        ],
        onDelete: async () => {
          const deleted = await model.deleteRoutine(selectedRoutine.id)
          if (!deleted) throw new Error('Routine deletion failed.')
          setEditingRoutineId((current) => current === selectedRoutine.id ? null : current)
          contextDrawer.onInvalidate([`routine:${selectedRoutine.id}`])
          navigation.select(contextItemIdForCommitmentParent(selectedRoutine.parent))
        }
      })
    : selectedCommitment
      ? adapterForCommitment(selectedCommitment)
      : activeCommitmentParent
        ? null
        : selectedThread
          ? adapterForThread(selectedThread)
          : focusDrawerAdapter({
              focus,
              onSave: onUpdateFocus,
              onDescriptionChange: model.saveDescription,
              onOpenDescription: model.openDescriptionInWindow,
              onDelete: onDeleteFocus
            })

  async function createThread(input: CreateThreadInput): Promise<void> {
    await model.createThread(input)
  }

  async function createCommitment(input: CreateCommitmentInput): Promise<void> {
    const created = await model.createCommitment(input)
    await onRefreshStatusSummary()
    const level = commitmentsLevelFor(created.parent)
    const nextCommitments = visibleSensitiveRecords(
      [...model.commitmentsFor(created.parent), created],
      hideSensitiveContent,
      parentIsSensitive(created.parent)
    )
    level.setItems(
      commitmentContextSidebarItems(
        nextCommitments
      )
    )
    focusLevel.setItems(
      focusContextSidebarItems(
        visibleThreadRecords,
        model.threadStatusSummaries,
        hideSensitiveContent,
        {
          ...commitmentsByContextItemId,
          [contextItemIdForCommitmentParent(created.parent)]: nextCommitments
        },
        routinesByContextItemId
      )
    )
    if (navigation.getSnapshot().level === level) {
      navigation.navigateToPath(level, String(created.id))
    } else {
      navigation.reset()
      navigation.selectChild(
        contextItemIdForCommitmentParent(created.parent),
        'commitments',
        String(created.id)
      )
    }
  }

  async function updateFocusDetails(input: UpdateFocusInput): Promise<boolean> {
    const key = `focus:${focus.id}`
    setWorkspaceStatusSavingKey(key)
    setWorkspaceStatusError(null)
    try {
      await onUpdateFocus(input)
      return true
    } catch {
      setWorkspaceStatusError({
        key,
        message: 'The Focus could not be updated. Please try again.'
      })
      return false
    } finally {
      setWorkspaceStatusSavingKey(null)
    }
  }

  async function updateThreadDetails(
    threadId: number,
    input: UpdateThreadInput
  ): Promise<boolean> {
    const key = `thread:${threadId}`
    setWorkspaceStatusSavingKey(key)
    setWorkspaceStatusError(null)
    try {
      const updated = await model.updateThread(threadId, input)
      if (contextDrawer.pinnedAdapter?.id === key) {
        contextDrawer.onPin(adapterForThread(updated))
      }
      return true
    } catch {
      setWorkspaceStatusError({
        key,
        message: 'The Thread could not be updated. Please try again.'
      })
      return false
    } finally {
      setWorkspaceStatusSavingKey(null)
    }
  }

  async function restoreArchivedThread(threadId: number): Promise<void> {
    setRestoringThreadId(threadId)
    setThreadArchiveError(null)
    const restored = await updateThreadDetails(threadId, { status: 'active' })
    if (!restored) {
      setThreadArchiveError('The Thread could not be restored. Please try again.')
    }
    setRestoringThreadId(null)
  }

  async function updateCommitmentDetails(
    commitmentId: number,
    input: UpdateCommitmentInput
  ): Promise<boolean> {
    setCommitmentStatusSavingId(commitmentId)
    setCommitmentStatusError(null)
    try {
      const updated = await model.updateCommitment(commitmentId, input)
      await onRefreshStatusSummary()
      if (contextDrawer.pinnedAdapter?.id === `commitment:${commitmentId}`) {
        contextDrawer.onPin(adapterForCommitment(updated))
      }
      return true
    } catch {
      setCommitmentStatusError({
        id: commitmentId,
        message: 'The commitment could not be updated. Please try again.'
      })
      return false
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
          onDescriptionChange: model.saveDescription,
          onOpenDescription: model.openDescriptionInWindow,
          onDelete: onDeleteFocus
        })
      )
    }
  }

  async function refreshCommitmentsAfterUpdates(
    parent: CommitmentParent
  ): Promise<void> {
    await model.refreshCommitments(parent)
    await onRefreshStatusSummary()
  }

  async function refreshThreadAfterUpdates(threadId: number): Promise<void> {
    const updated = await model.refreshThread(threadId)
    if (contextDrawer.pinnedAdapter?.id === `thread:${threadId}`) {
      contextDrawer.onPin(adapterForThread(updated))
    }
  }

  function drillIntoCommitments(parent: CommitmentParent): void {
    setStandaloneCommitmentRoute(null)
    const level = commitmentsLevelFor(parent)
    level.setItems(
      commitmentContextSidebarItems(visibleCommitmentsFor(parent))
    )
    navigation.navigateToPath(level)
  }

  function openCommitment(
    parent: CommitmentParent,
    commitmentId: number
  ): void {
    navigation.reset()
    const parentItemId = contextItemIdForCommitmentParent(parent)
    const isCurrent = buildCommitmentListModel(
      visibleCommitmentsFor(parent)
    ).current.some(({ id }) => id === commitmentId)
    if (isCurrent) {
      navigation.selectChild(parentItemId, 'commitments', String(commitmentId))
      return
    }
    navigation.select(parentItemId)
    setStandaloneCommitmentRoute({ parent, commitmentId })
  }

  function openRoutine(parent: CommitmentParent, routineId: number): void {
    navigation.reset()
    navigation.selectChild(
      contextItemIdForCommitmentParent(parent),
      'commitments',
      `routine:${routineId}`
    )
  }

  function pinCommitment(parent: CommitmentParent, commitmentId: number): void {
    const commitment = visibleCommitmentsFor(parent).find(
      (candidate) => candidate.id === commitmentId
    )
    if (commitment) contextDrawer.onPin(adapterForCommitment(commitment))
  }

  const main = (
    <main className="min-w-0 flex-1 overflow-auto bg-background">
        {selectedRoutine && editingRoutineId === selectedRoutine.id && selectedRoutineEditorParent ? (
          <RoutineEditor
            key={`${selectedRoutine.id}:${selectedRoutine.template.version}`}
            parent={selectedRoutineEditorParent}
            routine={selectedRoutine}
            saving={routineSaving}
            embedded
            onCancel={() => setEditingRoutineId(null)}
            onSave={async (input) => {
              setRoutineSaving(true)
              try {
                await model.updateRoutine(selectedRoutine.id, input as UpdateRoutineInput)
                return true
              } catch {
                return false
              } finally {
                setRoutineSaving(false)
              }
            }}
          />
        ) : selectedRoutine ? (
          <RoutineHistory
            model={routineHistoryModel(
              selectedRoutine,
              selectedRoutineSubjectId ?? undefined
            )}
            onEdit={() => setEditingRoutineId(selectedRoutine.id)}
            onMutateItem={async (itemId, input) => {
              await model.updateRoutineRunItem(itemId, input)
            }}
            onFinalizeCell={async (cellId) => {
              await model.finalizeRoutineCell(cellId)
            }}
          />
        ) : activeCommitmentParent && !commitmentRouteHidden ? (
          selectedCommitment ? (
            <NoteSplitWorkspace
              preferenceId="commitment"
              workspaceLabel="Commitment"
              note={defaultNote(selectedCommitment.notes)}
              primary={(
                <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="commitment-heading">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
                  <div className="min-w-0 flex-1">
                    <p className="mb-2 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                      Commitment
                    </p>
                    <h1 id="commitment-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                      <TaggedText value={selectedCommitment.title} />
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <WorkDueDateField
                        entityLabel="Commitment"
                        value={selectedCommitment.dueDate}
                        parent={selectedCommitment.parent.type === 'focus'
                          ? { label: 'Focus', dueDate: focus.dueDate }
                          : {
                              label: 'Thread',
                              dueDate: model.threads.find(
                                ({ id }) => id === selectedCommitment.parent.id
                              )?.dueDate ?? null
                            }}
                        disabled={commitmentStatusSavingId === selectedCommitment.id}
                        onValueChange={(dueDate) =>
                          updateCommitmentDetails(selectedCommitment.id, { dueDate })}
                      />
                      <p aria-label="Commitment last updated">
                        <span className="font-medium text-foreground/80">Last updated</span>
                        {' · '}{dateOrNeverLabel(selectedCommitment.lastUpdateDate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <SensitivityToggle
                      checked={selectedCommitment.sensitive}
                      disabled={commitmentStatusSavingId === selectedCommitment.id}
                      onCheckedChange={(sensitive) =>
                        void updateCommitmentDetails(selectedCommitment.id, { sensitive })
                      }
                    />
                    <WorkStatusSelect
                      aria-label="Commitment status"
                      value={selectedCommitment.status}
                      disabled={commitmentStatusSavingId === selectedCommitment.id}
                      onValueChange={(status) =>
                        void updateCommitmentDetails(selectedCommitment.id, { status })
                      }
                    />
                  </div>
                </div>
                {commitmentStatusError?.id === selectedCommitment.id && (
                  <p role="alert" className="mt-3 text-xs text-destructive">
                    {commitmentStatusError.message}
                  </p>
                )}
                {commitmentWorkingContext.loading ? (
                  <p role="status" className="mt-8 text-xs text-muted-foreground">
                    Loading working context…
                  </p>
                ) : commitmentWorkingContext.error ? (
                  <p role="alert" className="mt-8 text-xs text-destructive">
                    {commitmentWorkingContext.error}
                  </p>
                ) : commitmentWorkingContext.snapshot ? (
                  <>
                    <DirectTodos
                      key={`commitment-todos:${selectedCommitment.id}:${selectedCommitmentCell?.subjectId ?? 'all'}`}
                      context={selectedCommitmentCell
                        ? {
                            type: 'commitment-scope',
                            id: selectedCommitment.id,
                            scope: {
                              scopeId: selectedCommitmentCell.scopeId,
                              subjectId: selectedCommitmentCell.subjectId
                            }
                          }
                        : { type: 'commitment', id: selectedCommitment.id }}
                      currentCells={commitmentWorkingContext.snapshot.cells.map((cell) => ({
                        cell: { scopeId: cell.scopeId, subjectId: cell.subjectId },
                        subjectName: cell.subject.name
                      }))}
                    />
                    <DirectUpdates
                      key={`${selectedCommitment.id}:${commitmentWorkingContext.snapshot.scopeId ?? 'open'}:${selectedCommitmentCell?.subjectId ?? 'all'}`}
                      parent={{ type: 'commitment', id: selectedCommitment.id }}
                      context={selectedCommitmentCell
                        ? {
                            mode: 'subject',
                            cell: {
                              scopeId: selectedCommitmentCell.scopeId,
                              subjectId: selectedCommitmentCell.subjectId
                            },
                            subject: selectedCommitmentCell.subject
                          }
                        : commitmentWorkingContext.snapshot.scopeId === null
                          ? { mode: 'aggregate' }
                          : {
                              mode: 'scope-overview',
                              currentScopeId: commitmentWorkingContext.snapshot.scopeId,
                              subjects: commitmentWorkingContext.snapshot.cells.map(
                                ({ subject }) => subject
                              )
                            }}
                      hideSensitiveContent={hideSensitiveContent}
                      ancestorSensitive={
                        focus.sensitive ||
                        selectedCommitment.sensitive ||
                        (selectedCommitment.parent.type === 'thread' &&
                          (model.threads.find(
                            (thread) => thread.id === selectedCommitment.parent.id
                          )?.sensitive ?? true))
                      }
                      onUpdatesChanged={() => Promise.all([
                        refreshCommitmentsAfterUpdates(selectedCommitment.parent),
                        commitmentWorkingContext.refresh()
                      ]).then(() => undefined)}
                    />
                  </>
                ) : null}
                </section>
              )}
            />
          ) : (
            <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="commitment-heading">
                <h1 id="commitment-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                  Commitments
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">No commitments yet.</p>
            </section>
          )
        ) : displayedThread ? (
          <NoteSplitWorkspace
            preferenceId="thread"
            workspaceLabel="Thread"
            note={defaultNote(displayedThread.notes)}
            primary={(
              <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="thread-heading">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
              <div className="min-w-0 flex-1">
                <h1 id="thread-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                  <TaggedText value={displayedThread.title} />
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                  <WorkDueDateField
                    entityLabel="Thread"
                    value={displayedThread.dueDate}
                    parent={{ label: 'Focus', dueDate: focus.dueDate }}
                    disabled={workspaceStatusSavingKey === `thread:${displayedThread.id}`}
                    onValueChange={(dueDate) =>
                      updateThreadDetails(displayedThread.id, { dueDate })}
                  />
                  <p aria-label="Thread last reviewed">
                    <span className="font-medium text-foreground/80">Last reviewed</span>
                    {' · '}{dateOrNeverLabel(displayedThread.lastReviewDate)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <SensitivityToggle
                  checked={displayedThread.sensitive}
                  disabled={workspaceStatusSavingKey === `thread:${displayedThread.id}`}
                  onCheckedChange={(sensitive) =>
                    void updateThreadDetails(displayedThread.id, { sensitive })
                  }
                />
                <WorkStatusSelect
                  aria-label="Thread status"
                  value={displayedThread.status}
                  disabled={workspaceStatusSavingKey === `thread:${displayedThread.id}`}
                  onValueChange={(status) =>
                    void updateThreadDetails(displayedThread.id, { status })
                  }
                />
              </div>
            </div>
            {workspaceStatusError?.key === `thread:${displayedThread.id}` && (
              <p role="alert" className="mt-3 text-xs text-destructive">
                {workspaceStatusError.message}
              </p>
            )}
            {!displayedThreadScope || !displayedThreadSubjectMatrix ? (
              <p role="status" className="mt-6 text-xs text-muted-foreground">
                Loading working context…
              </p>
            ) : (() => {
                const scope = displayedThreadScope
                const selectedSubject = selectedThreadSubject
                const subjectCell = selectedThreadSubjectCell
                const threadCommitments = visibleCommitmentsFor({
                  type: 'thread',
                  id: displayedThread.id
                })
                const displayedCommitments = subjectCell
                  ? commitmentsForThreadSubject(threadCommitments, subjectCell)
                  : threadCommitments
                const updateContext = selectedSubject && subjectCell
                  ? {
                      mode: 'subject' as const,
                      cell: {
                        scopeId: subjectCell.scopeId,
                        subjectId: subjectCell.subjectId
                      },
                      subject: selectedSubject
                    }
                  : scope.scopeId === null || scope.subjects.length === 0
                    ? { mode: 'aggregate' as const }
                    : {
                        mode: 'scope-overview' as const,
                        currentScopeId: scope.scopeId,
                        subjects: scope.subjects,
                        knownSubjects: [
                          ...scope.subjects,
                          ...scope.focusSubjects.filter(
                            ({ id }) => !scope.subjects.some((subject) => subject.id === id)
                          )
                        ]
                      }

                return (
                  <>
                    <CommitmentCollection
                      idPrefix={`thread-${displayedThread.id}${selectedSubject ? `-subject-${selectedSubject.id}` : ''}`}
                      model={commitmentCollectionModel(
                        buildCommitmentListModel(displayedCommitments)
                      )}
                      contextLabel={selectedSubject
                        ? `${selectedSubject.name} only · create and change Commitment scope from All subjects.`
                        : undefined}
                      statusSavingId={commitmentStatusSavingId}
                      statusError={commitmentStatusError}
                      onCreate={selectedSubject ? undefined : () =>
                        setNewCommitmentParent({ type: 'thread', id: displayedThread.id })
                      }
                      onCreateRoutine={selectedSubject ? undefined : () =>
                        setNewRoutineParent({ type: 'thread', id: displayedThread.id })
                      }
                      onOpenCollection={selectedSubject ? undefined : () =>
                        drillIntoCommitments({ type: 'thread', id: displayedThread.id })
                      }
                      onOpen={(commitmentId) =>
                        openCommitment(
                          { type: 'thread', id: displayedThread.id },
                          commitmentId
                        )
                      }
                      onPin={(commitmentId) =>
                        pinCommitment(
                          { type: 'thread', id: displayedThread.id },
                          commitmentId
                        )
                      }
                      onComplete={(commitmentId) =>
                        void updateCommitmentDetails(commitmentId, { status: 'done' })
                      }
                    />
                    {!selectedSubject && (
                      <RoutineManagementList
                        idPrefix={`thread-${displayedThread.id}`}
                        model={routineManagementListModel(
                          visibleSensitiveRecords(
                            model.routinesFor({ type: 'thread', id: displayedThread.id }),
                            hideSensitiveContent,
                            focus.sensitive || displayedThread.sensitive
                          )
                        )}
                        onOpen={(routineId) => {
                          const routine = model.routinesFor({
                            type: 'thread',
                            id: displayedThread.id
                          }).find(({ id }) => id === routineId)
                          if (routine) openRoutine(routine.parent, routine.id)
                        }}
                      />
                    )}
                    <DirectTodos
                      key={`thread-todos:${displayedThread.id}:${subjectCell?.subjectId ?? 'all'}`}
                      context={subjectCell
                        ? {
                            type: 'thread-scope',
                            id: displayedThread.id,
                            scope: {
                              scopeId: subjectCell.scopeId,
                              subjectId: subjectCell.subjectId
                            }
                          }
                        : { type: 'thread', id: displayedThread.id }}
                      currentCells={displayedThreadSubjectMatrix.map((cell) => ({
                        cell: { scopeId: cell.scopeId, subjectId: cell.subjectId },
                        subjectName: cell.subject.name
                      }))}
                    />
                    <DirectUpdates
                      key={`thread-updates:${displayedThread.id}:${scope.scopeId ?? 'open'}:${selectedSubject?.id ?? 'all'}`}
                      parent={{ type: 'thread', id: displayedThread.id }}
                      context={updateContext}
                      hideSensitiveContent={hideSensitiveContent}
                      ancestorSensitive={focus.sensitive || displayedThread.sensitive}
                      onUpdatesChanged={() => refreshThreadAfterUpdates(displayedThread.id)}
                    />
                  </>
                )
              })()}
              </section>
            )}
          />
        ) : (
          <NoteSplitWorkspace
            preferenceId="focus"
            workspaceLabel="Focus"
            note={defaultNote(focus.notes)}
            primary={(
              <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="focus-heading">
            <div className="flex flex-wrap items-start gap-3 border-b border-border/70 pb-6">
              <div className="min-w-0 flex-1">
                <h1 id="focus-heading" className="truncate text-2xl font-semibold tracking-[-0.025em]">
                  <TaggedText value={focusTitle} />
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                  <WorkDueDateField
                    entityLabel="Focus"
                    value={focus.dueDate}
                    disabled={workspaceStatusSavingKey === `focus:${focus.id}`}
                    onValueChange={(dueDate) => updateFocusDetails({ dueDate })}
                  />
                  <p aria-label="Focus last reviewed">
                    <span className="font-medium text-foreground/80">Last reviewed</span>
                    {' · '}{dateOrNeverLabel(focus.lastReviewDate)}
                  </p>
                </div>
                {focus.description ? (
                  <RichTextContent
                    value={focus.description}
                    ariaLabel="Focus description"
                    className="mt-1.5 max-w-2xl text-muted-foreground"
                    onOpenInWindow={model.openDescriptionInWindow}
                  />
                ) : (
                  <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                    No description or notes.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <SensitivityToggle
                  checked={focus.sensitive}
                  disabled={workspaceStatusSavingKey === `focus:${focus.id}`}
                  onCheckedChange={(sensitive) =>
                    void updateFocusDetails({ sensitive })
                  }
                />
                <WorkStatusSelect
                  aria-label="Focus status"
                  value={focus.status}
                  disabled={workspaceStatusSavingKey === `focus:${focus.id}`}
                  onValueChange={(status) => void updateFocusDetails({ status })}
                />
              </div>
            </div>

            {workspaceStatusError?.key === `focus:${focus.id}` && (
              <p role="alert" className="mt-3 text-xs text-destructive">
                {workspaceStatusError.message}
              </p>
            )}

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
                externalRevision={model.goalRevision}
                onChange={model.setGoal}
                onBlur={(value) => void model.saveGoal(value)}
                onOpenInWindow={model.openGoalInWindow}
              />
              {model.goalError && <p role="alert" className="mt-2 text-xs text-destructive">{model.goalError}</p>}
            </div>

            <FocusScopeEditor
              model={model.focusScope ? focusScopeEditorModel(model.focusScope) : null}
              loading={model.focusScopeLoading}
              saving={model.focusScopeSaving}
              error={model.focusScopeError}
              onAdd={model.addFocusScopeSubject}
              onRemove={async (subjectId) => {
                await model.removeFocusScopeSubject(subjectId)
                if (selectedSubjectId === subjectId) onSelectedSubjectChange(null)
              }}
            />

            <CommitmentCollection
              idPrefix={`focus-${focus.id}`}
              model={commitmentCollectionModel(
                buildCommitmentListModel(
                  visibleCommitmentsFor({ type: 'focus', id: focus.id })
                )
              )}
              statusSavingId={commitmentStatusSavingId}
              statusError={commitmentStatusError}
              onCreate={() =>
                setNewCommitmentParent({ type: 'focus', id: focus.id })
              }
              onCreateRoutine={() =>
                setNewRoutineParent({ type: 'focus', id: focus.id })
              }
              onOpenCollection={() =>
                drillIntoCommitments({ type: 'focus', id: focus.id })
              }
              onOpen={(commitmentId) =>
                openCommitment(
                  { type: 'focus', id: focus.id },
                  commitmentId
                )
              }
              onPin={(commitmentId) =>
                pinCommitment({ type: 'focus', id: focus.id }, commitmentId)
              }
              onComplete={(commitmentId) =>
                void updateCommitmentDetails(commitmentId, { status: 'done' })
              }
            />

            <RoutineManagementList
              idPrefix={`focus-${focus.id}`}
              model={routineManagementListModel(
                visibleSensitiveRecords(
                  model.routinesFor({ type: 'focus', id: focus.id }),
                  hideSensitiveContent,
                  focus.sensitive
                )
              )}
              onOpen={(routineId) => {
                const routine = model.routinesFor({
                  type: 'focus',
                  id: focus.id
                }).find(({ id }) => id === routineId)
                if (routine) openRoutine(routine.parent, routine.id)
              }}
            />

            <DirectTodos context={{ type: 'focus', id: focus.id }} />

            <DirectUpdates
              key={`focus-updates:${focus.id}`}
              parent={{ type: 'focus', id: focus.id }}
              hideSensitiveContent={hideSensitiveContent}
              ancestorSensitive={focus.sensitive}
              onUpdatesChanged={refreshFocusAfterUpdates}
            />

            {model.loadError && <p role="alert" className="mt-5 text-sm text-destructive">{model.loadError}</p>}
              </section>
            )}
          />
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
        tabBar={selectedRoutine ? (
          routineContextTabs && routineContextTabs.items.length > 1 ? (
            <WorkspaceTabBar
              model={routineContextTabs}
              selectedId={selectedRoutineSubjectId !== null
                ? `subject:${selectedRoutineSubjectId}`
                : routineContextTabs.items[0].id}
              onSelect={selectRoutineContext}
            />
          ) : undefined
        ) : selectedCommitment && commitmentContextTabs &&
          commitmentContextTabs.items.length > 1 ? (
          <WorkspaceTabBar
            model={commitmentContextTabs}
            selectedId={selectedCommitmentCell
              ? `subject:${selectedCommitmentCell.subjectId}`
              : 'all'}
            onSelect={selectCommitmentContext}
          />
        ) : displayedThread && threadContextTabs && threadContextTabs.items.length > 1 ? (
          <WorkspaceTabBar
            model={threadContextTabs}
            selectedId={selectedThreadSubject ? `subject:${selectedThreadSubject.id}` : 'all'}
            onSelect={selectThreadContext}
          />
        ) : undefined}
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
      {threadArchiveOpen && (
        <ThreadArchiveDialog
          items={archivedThreads}
          restoringId={restoringThreadId}
          error={threadArchiveError}
          onRestore={(threadId) => void restoreArchivedThread(threadId)}
          onClose={() => {
            if (restoringThreadId !== null) return
            setThreadArchiveError(null)
            setThreadArchiveOpen(false)
          }}
        />
      )}
      {newCommitmentParent && (
        <NewCommitmentDialog
          parent={newCommitmentParent}
          onClose={() => setNewCommitmentParent(null)}
          onCreate={createCommitment}
        />
      )}
      {newRoutineParent && newRoutineEditorParent && (
        <RoutineEditorDialog
          parent={newRoutineEditorParent}
          saving={routineSaving}
          onClose={() => setNewRoutineParent(null)}
          onSave={async (input) => {
            setRoutineSaving(true)
            try {
              await model.createRoutine(input)
              return true
            } catch {
              return false
            } finally {
              setRoutineSaving(false)
            }
          }}
        />
      )}
      {pendingThreadMove && (
        <Dialog
          open
          title={`Move ${pendingThreadMove.threadTitle}?`}
          description={`Moving it to ${pendingThreadMove.targetTitle} will widen that Focus's Scope.`}
          onClose={() => !threadMoveSaving && setPendingThreadMove(null)}
          footer={
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={threadMoveSaving}
                onClick={() => setPendingThreadMove(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={threadMoveSaving}
                onClick={() => void executeThreadMove(
                  pendingThreadMove.plan,
                  pendingThreadMove.plan.scopeSubjectAdditions.map(({ id }) => id)
                )}
              >
                {threadMoveSaving ? 'Moving…' : 'Move Thread'}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-6">
            The following {pendingThreadMove.plan.scopeSubjectAdditions.length === 1
              ? 'Subject is'
              : 'Subjects are'} not currently covered and will be added:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {pendingThreadMove.plan.scopeSubjectAdditions.map((subject) => (
              <li key={subject.id}>{subject.name}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {pendingThreadMove.plan.ownedRecords.commitments} Commitments,{' '}
            {pendingThreadMove.plan.ownedRecords.updates} Updates,{' '}
            {pendingThreadMove.plan.ownedRecords.todos} Todos, and{' '}
            {pendingThreadMove.plan.ownedRecords.notes} Notes remain attached to the Thread.
          </p>
          {threadMoveError && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {threadMoveError}
            </p>
          )}
        </Dialog>
      )}
      {pendingCommitmentMove && (
        <Dialog
          open
          title={`Move ${pendingCommitmentMove.commitmentTitle}?`}
          description={`Moving it to ${pendingCommitmentMove.targetLabel} will widen that context's Scope.`}
          onClose={() => !commitmentMoveSaving && setPendingCommitmentMove(null)}
          footer={
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={commitmentMoveSaving}
                onClick={() => setPendingCommitmentMove(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={commitmentMoveSaving}
                onClick={() => void executeCommitmentMove(
                  pendingCommitmentMove.plan,
                  pendingCommitmentMove.plan.scopeSubjectAdditions.map(({ id }) => id)
                )}
              >
                {commitmentMoveSaving ? 'Moving…' : 'Move Commitment'}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-6">
            The following {pendingCommitmentMove.plan.scopeSubjectAdditions.length === 1
              ? 'Subject is'
              : 'Subjects are'} not currently covered and will be added:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {pendingCommitmentMove.plan.scopeSubjectAdditions.map((subject) => (
              <li key={subject.id}>{subject.name}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {pendingCommitmentMove.plan.ownedRecords.updates} Updates,{' '}
            {pendingCommitmentMove.plan.ownedRecords.todos} Todos, and{' '}
            {pendingCommitmentMove.plan.ownedRecords.notes} Notes remain attached to the Commitment.
          </p>
          {commitmentMoveError && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {commitmentMoveError}
            </p>
          )}
        </Dialog>
      )}
      {commitmentMoveError && !pendingCommitmentMove && (
        <p
          role="alert"
          className="fixed right-5 bottom-5 z-50 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive shadow-lg"
        >
          {commitmentMoveError}
        </p>
      )}
      {routineMoveError && (
        <p
          role="alert"
          className="fixed right-5 bottom-5 z-50 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive shadow-lg"
        >
          {routineMoveError}
        </p>
      )}
      {threadMoveError && !pendingThreadMove && (
        <p
          role="alert"
          className="fixed right-5 bottom-5 z-50 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive shadow-lg"
        >
          {threadMoveError}
        </p>
      )}
    </>
  )
}
