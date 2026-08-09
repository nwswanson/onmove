import { useEffect, useMemo, useState } from 'react'
import type {
  CommitmentParent,
  CommitmentScopeSnapshot,
  CommitmentSnapshot,
  CreateCommitmentInput,
  CreateThreadInput,
  FocusSnapshot,
  SubjectSnapshot,
  ThreadSnapshot,
  ThreadScopeSnapshot,
  ThreadSubjectCellSnapshot,
  UpdateCommitmentInput,
  UpdateFocusInput,
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
  useContextualSidebarNavigation
} from '@/components/ui/contextual-sidebar'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RichTextContent, RichTextEditor } from '@/components/ui/rich-text-editor'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { WorkspaceTabBar } from '@/components/ui/workspace-tab-bar'
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
  commitmentDueDateLabel,
  commitmentDrawerAdapter,
  commitmentWorkingContextModel,
  commitmentTypeLabel,
  dateOrNeverLabel,
  focusContextSidebarItems,
  focusDrawerAdapter,
  focusScopeEditorModel,
  threadDrawerAdapter,
  threadWorkingContextModel,
  threadSidebarItemId
} from '@/features/focus/focus-presenters'
import { useCommitmentWorkingContextModel } from '@/features/focus/use-commitment-working-context-model'
import { useFocusWorkspaceModel } from '@/features/focus/use-focus-workspace-model'
import { WorkStatusSelect } from '@/features/shared/work-status-select'
import { visibleSensitiveRecords } from '@/features/shared/sensitivity'
import { SensitivityToggle } from '@/features/shared/sensitivity-toggle'
import { DirectUpdates } from '@/features/updates/direct-updates'

const CONTEXTUAL_SIDEBAR_MIN = 220
const CONTEXTUAL_SIDEBAR_MAX = 320

function contextItemIdForCommitmentParent(parent: CommitmentParent): string {
  return parent.type === 'focus' ? 'overall' : threadSidebarItemId(parent.id)
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

interface FocusWorkspaceProps {
  focus: FocusSnapshot
  contextDrawer: ContextDrawerControl
  onUpdateFocus: (input: UpdateFocusInput) => Promise<void>
  onRefreshFocus: () => Promise<FocusSnapshot>
  onRefreshStatusSummary: () => Promise<void>
  onDeleteFocus: () => Promise<void>
  selectedSubjectId: number | null
  onSelectedSubjectChange: (subjectId: number | null) => void
  hideSensitiveContent?: boolean
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
  hideSensitiveContent = false
}: FocusWorkspaceProps): React.JSX.Element {
  const model = useFocusWorkspaceModel({ focus, onUpdateFocus })
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  const [newCommitmentParent, setNewCommitmentParent] =
    useState<CommitmentParent | null>(null)
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
  const [focusLevel] = useState(
    () =>
      new ContextualSidebarLevel({
        id: `focus:${focus.id}`,
        title: 'Focus',
        ariaLabel: 'Focus sections',
        items: focusContextSidebarItems([], {}, false, { overall: [] }),
        onChildCollectionAction: (parentItemId, collectionId, actionId) => {
          if (collectionId !== 'commitments' || actionId !== 'add') return
          const parent = commitmentParentForContextItem(parentItemId, focus.id)
          if (parent) setNewCommitmentParent(parent)
        },
        newItem: {
          label: 'New thread',
          onCreate: () => setNewThreadOpen(true)
        }
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

  const visibleThreadRecords = useMemo<readonly ThreadSnapshot[]>(
    () => visibleSensitiveRecords(
      model.threads,
      hideSensitiveContent,
      focus.sensitive
    ),
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
        commitmentsByContextItemId
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
    visibleFocusCommitments,
    visibleThreadCommitments,
    visibleThreadRecords,
    hideSensitiveContent,
    navigation,
    threadCommitmentLevels
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
    navigationSnapshot.level === focusLevel && navigationSnapshot.selectedChild
      ? commitmentParentForContextItem(
          navigationSnapshot.selectedChild.parentItemId,
          focus.id
        )
      : null
  const activeCommitmentParent = childCommitmentParent ?? levelCommitmentParent
  const commitmentRouteFromChild = childCommitmentParent !== null
  const rawActiveCommitments = activeCommitmentParent
    ? model.commitmentsFor(activeCommitmentParent)
    : []
  const activeCommitments = activeCommitmentParent
    ? visibleCommitmentsFor(activeCommitmentParent)
    : []
  const routedCommitmentId = commitmentRouteFromChild
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

  useEffect(() => {
    if (!hideSensitiveContent) return
    if (commitmentRouteHiddenByAncestor) {
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
    activeParentThread
  ])

  function adapterForCommitment(
    commitment: CommitmentSnapshot,
    scope = model.commitmentScopes[commitment.id]
  ): ContextDrawerAdapter {
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
    async function mutateScope(
      operation: () => Promise<CommitmentScopeSnapshot>
    ): Promise<void> {
      const nextScope = await operation()
      if (
        selectedSubjectId !== null &&
        !nextScope.subjects.some(({ id }) => id === selectedSubjectId)
      ) onSelectedSubjectChange(null)
      if (selectedCommitment?.id === commitment.id) {
        await commitmentWorkingContext.refresh()
      }
      if (contextDrawer.pinnedAdapter?.id === `commitment:${commitment.id}`) {
        contextDrawer.onPin(adapterForCommitment(commitment, nextScope))
      }
    }
    return commitmentDrawerAdapter({
      commitment,
      parentTitle: thread?.title ?? 'Thread',
      ancestorKeys: [`focus:${focus.id}`, `thread:${commitment.parent.id}`],
      onSave: (input) => saveCommitmentFromDrawer(commitment.id, input),
      onDelete: () => deleteCommitmentFromDrawer(commitment),
      scopeEditor: scope ? {
        scope,
        parentLabel: 'Thread',
        onCustomize: () => mutateScope(() => model.customizeCommitmentScope(commitment.id)),
        onFollowParent: () =>
          mutateScope(() => model.followParentCommitmentScope(commitment.id)),
        onAddSubject: (name) =>
          mutateScope(() => model.addCommitmentScopeSubject(commitment.id, name)),
        onRemoveSubject: (subjectId) =>
          mutateScope(() => model.removeCommitmentScopeSubject(commitment.id, subjectId))
      } : undefined
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
      snapshot.level.id === `thread:${threadId}:commitments`
  }

  async function deleteThreadFromDrawer(threadId: number): Promise<void> {
    const routeUsesThread = currentRouteUsesThread(threadId)
    const deleted = await model.deleteThread(threadId)
    if (!deleted) throw new Error('Thread deletion did not remove a record.')

    contextDrawer.onInvalidate([`thread:${threadId}`])
    if (routeUsesThread) {
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
    const deleted = await model.deleteCommitment(commitment.id)
    if (!deleted) throw new Error('Commitment deletion did not remove a record.')

    contextDrawer.onInvalidate([`commitment:${commitment.id}`])
    if (selectedAsChild) {
      navigation.select(contextItemIdForCommitmentParent(commitment.parent))
    } else if (selectedInLevel) {
      navigation.back()
    }
    try {
      await onRefreshStatusSummary()
    } catch {
      // The record is already deleted and local collections are authoritative;
      // a later refresh can repair a stale aggregate summary.
    }
  }

  const contextDrawerAdapter: ContextDrawerAdapter | null = selectedCommitment
    ? adapterForCommitment(selectedCommitment)
    : activeCommitmentParent
      ? null
      : selectedThread
        ? adapterForThread(selectedThread)
        : focusDrawerAdapter({
            focus,
            onSave: onUpdateFocus,
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
        }
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

  async function updateFocusDetails(input: UpdateFocusInput): Promise<void> {
    const key = `focus:${focus.id}`
    setWorkspaceStatusSavingKey(key)
    setWorkspaceStatusError(null)
    try {
      await onUpdateFocus(input)
    } catch {
      setWorkspaceStatusError({
        key,
        message: 'The Focus could not be updated. Please try again.'
      })
    } finally {
      setWorkspaceStatusSavingKey(null)
    }
  }

  async function updateThreadDetails(
    threadId: number,
    input: UpdateThreadInput
  ): Promise<void> {
    const key = `thread:${threadId}`
    setWorkspaceStatusSavingKey(key)
    setWorkspaceStatusError(null)
    try {
      const updated = await model.updateThread(threadId, input)
      if (contextDrawer.pinnedAdapter?.id === key) {
        contextDrawer.onPin(adapterForThread(updated))
      }
    } catch {
      setWorkspaceStatusError({
        key,
        message: 'The Thread could not be updated. Please try again.'
      })
    } finally {
      setWorkspaceStatusSavingKey(null)
    }
  }

  async function updateCommitmentDetails(
    commitmentId: number,
    input: UpdateCommitmentInput
  ): Promise<void> {
    setCommitmentStatusSavingId(commitmentId)
    setCommitmentStatusError(null)
    try {
      const updated = await model.updateCommitment(commitmentId, input)
      await onRefreshStatusSummary()
      if (contextDrawer.pinnedAdapter?.id === `commitment:${commitmentId}`) {
        contextDrawer.onPin(adapterForCommitment(updated))
      }
    } catch {
      setCommitmentStatusError({
        id: commitmentId,
        message: 'The commitment could not be updated. Please try again.'
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
    navigation.selectChild(
      contextItemIdForCommitmentParent(parent),
      'commitments',
      String(commitmentId)
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
        {activeCommitmentParent && !commitmentRouteHidden ? (
          <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="commitment-heading">
            {selectedCommitment ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
                  <div className="min-w-0 flex-1">
                    <p className="mb-2 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                      Commitment
                    </p>
                    <h1 id="commitment-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                      {selectedCommitment.title}
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <p aria-label="Commitment type">
                        <span className="font-medium text-foreground/80">Type</span>
                        {' · '}{commitmentTypeLabel(selectedCommitment.type)}
                      </p>
                      <p aria-label="Commitment due date">
                        <span className="font-medium text-foreground/80">Due date</span>
                        {' · '}{commitmentDueDateLabel(selectedCommitment.dueDate)}
                      </p>
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
                ) : null}
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
        ) : displayedThread ? (
          <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="thread-heading">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
              <div className="min-w-0 flex-1">
                <h1 id="thread-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                  {displayedThread.title}
                </h1>
                <p
                  aria-label="Thread last reviewed"
                  className="mt-2 text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground/80">Last reviewed</span>
                  {' · '}{dateOrNeverLabel(displayedThread.lastReviewDate)}
                </p>
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
        ) : (
          <section className="mx-auto w-full max-w-5xl p-8 sm:p-10" aria-labelledby="focus-heading">
            <div className="flex flex-wrap items-start gap-3 border-b border-border/70 pb-6">
              <div className="min-w-0 flex-1">
                <h1 id="focus-heading" className="truncate text-2xl font-semibold tracking-[-0.025em]">
                  {focusTitle}
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
                onChange={model.setGoal}
                onBlur={(value) => void model.saveGoal(value)}
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
        tabBar={selectedCommitment && commitmentContextTabs &&
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
      {newCommitmentParent && (
        <NewCommitmentDialog
          parent={newCommitmentParent}
          onClose={() => setNewCommitmentParent(null)}
          onCreate={createCommitment}
        />
      )}
    </>
  )
}
