import { useEffect, useRef, useState } from 'react'
import type {
  CommitmentParent,
  CommitmentMovePlanSnapshot,
  CommitmentSnapshot,
  CreateCommitmentInput,
  CreateRoutineInput,
  CreateThreadInput,
  FocusSnapshot,
  FocusScopeSnapshot,
  RoutineSnapshot,
  MoveCommitmentInput,
  MoveThreadInput,
  ThreadSnapshot,
  ThreadMovePlanSnapshot,
  ThreadScopeSnapshot,
  ThreadSubjectCellSnapshot,
  UpdateCommitmentInput,
  UpdateThreadInput
} from '../../../../shared/contracts'
import { useDurableRichText } from '@/features/rich-text/use-durable-rich-text'
import {
  buildCommitmentListModel,
  type CommitmentListModel
} from '@/features/focus/commitment-list-model'
import {
  buildStatusSummary,
  EMPTY_STATUS_SUMMARY,
  type StatusSummary
} from '@/features/shared/status-summary'
import { subscribeToUpdateCreated } from '@/features/updates/update-creation-events'

interface FocusWorkspaceModelOptions {
  focus: FocusSnapshot
}

export interface FocusWorkspaceModel {
  goal: string
  setGoal: (goal: string) => void
  goalSaving: boolean
  goalRevision: number
  goalError: string | null
  focusScope: FocusScopeSnapshot | null
  focusScopeLoading: boolean
  focusScopeSaving: boolean
  focusScopeError: string | null
  loadError: string | null
  threads: ThreadSnapshot[]
  threadScopes: Readonly<Record<number, ThreadScopeSnapshot | undefined>>
  threadSubjectMatrices: Readonly<Record<number, readonly ThreadSubjectCellSnapshot[] | undefined>>
  threadStatusSummaries: Readonly<Record<number, StatusSummary | undefined>>
  commitments: CommitmentSnapshot[]
  threadCommitments: Readonly<Record<number, readonly CommitmentSnapshot[] | undefined>>
  commitmentList: CommitmentListModel
  commitmentsFor: (parent: CommitmentParent) => readonly CommitmentSnapshot[]
  saveGoal: (goal?: string) => Promise<void>
  openGoalInWindow: () => void
  saveDescription: (value: string) => void
  openDescriptionInWindow: () => void
  addFocusScopeSubject: (name: string) => Promise<void>
  removeFocusScopeSubject: (subjectId: number) => Promise<void>
  createThread: (input: CreateThreadInput) => Promise<ThreadSnapshot>
  updateThread: (id: number, input: UpdateThreadInput) => Promise<ThreadSnapshot>
  planThreadMove: (id: number, focusId: number) => Promise<ThreadMovePlanSnapshot>
  moveThread: (id: number, input: MoveThreadInput) => Promise<ThreadSnapshot>
  deleteThread: (id: number) => Promise<boolean>
  customizeThreadScope: (threadId: number) => Promise<ThreadScopeSnapshot>
  followFocusThreadScope: (threadId: number) => Promise<ThreadScopeSnapshot>
  addThreadScopeSubject: (threadId: number, name: string) => Promise<ThreadScopeSnapshot>
  removeThreadScopeSubject: (
    threadId: number,
    subjectId: number
  ) => Promise<ThreadScopeSnapshot>
  createCommitment: (input: CreateCommitmentInput) => Promise<CommitmentSnapshot>
  createRoutine: (input: CreateRoutineInput) => Promise<RoutineSnapshot>
  updateCommitment: (id: number, input: UpdateCommitmentInput) => Promise<CommitmentSnapshot>
  planCommitmentMove: (
    id: number,
    parent: CommitmentParent
  ) => Promise<CommitmentMovePlanSnapshot>
  moveCommitment: (id: number, input: MoveCommitmentInput) => Promise<CommitmentSnapshot>
  deleteCommitment: (id: number) => Promise<boolean>
  refreshCommitments: (parent?: CommitmentParent) => Promise<void>
  refreshThread: (threadId: number) => Promise<ThreadSnapshot>
}

function summaryWithCommitment(
  summary: StatusSummary | undefined,
  commitment: CommitmentSnapshot
): StatusSummary {
  const current = summary ?? EMPTY_STATUS_SUMMARY
  const withoutCommitment = current.activeCommitments.filter(
    (candidate) => candidate.id !== commitment.id
  )
  return {
    ...current,
    activeCommitments: commitment.status === 'active'
      ? [
          ...withoutCommitment,
          {
            id: commitment.id,
            title: commitment.title,
            state: commitment.state,
            sensitive: commitment.sensitive,
            ancestorSensitive: false
          }
        ]
      : withoutCommitment
  }
}

function summaryWithoutCommitment(
  summary: StatusSummary | undefined,
  commitmentId: number
): StatusSummary {
  const current = summary ?? EMPTY_STATUS_SUMMARY
  return {
    ...current,
    activeCommitments: current.activeCommitments.filter(({ id }) => id !== commitmentId)
  }
}

function withoutRecordKey<T>(
  records: Readonly<Record<number, T | undefined>>,
  id: number
): Record<number, T | undefined> {
  return Object.fromEntries(
    Object.entries(records).filter(([key]) => Number(key) !== id)
  )
}

interface ThreadWorkspaceProjection {
  threadId: number
  commitments: CommitmentSnapshot[]
  summary: StatusSummary
  scope: ThreadScopeSnapshot
  subjectMatrix: ThreadSubjectCellSnapshot[]
}

interface FocusThreadWorkspaceData {
  threads: ThreadSnapshot[]
  projections: ThreadWorkspaceProjection[]
}

async function loadFocusThreadWorkspaceData(focusId: number): Promise<FocusThreadWorkspaceData> {
  const threads = await window.onmove.domain.listThreads(focusId)
  const projections = await Promise.all(
    threads.map(async (thread) => {
      const [commitments, updates, scope, subjectMatrix] = await Promise.all([
        window.onmove.domain.listCommitments({ type: 'thread', id: thread.id }),
        window.onmove.domain.listUpdates({ type: 'thread', id: thread.id }),
        window.onmove.domain.getThreadScope(thread.id),
        window.onmove.domain.getThreadSubjectMatrix(thread.id)
      ])
      return {
        threadId: thread.id,
        commitments,
        summary: buildStatusSummary(updates, commitments),
        scope,
        subjectMatrix
      }
    })
  )
  return { threads, projections }
}

/** Persistence-backed state and operations for a Focus workspace. */
export function useFocusWorkspaceModel({
  focus
}: FocusWorkspaceModelOptions): FocusWorkspaceModel {
  const [loadError, setLoadError] = useState<string | null>(null)
  const [focusScope, setFocusScope] = useState<FocusScopeSnapshot | null>(null)
  const [focusScopeLoading, setFocusScopeLoading] = useState(true)
  const [focusScopeSaving, setFocusScopeSaving] = useState(false)
  const [focusScopeError, setFocusScopeError] = useState<string | null>(null)
  const [threads, setThreads] = useState<ThreadSnapshot[]>([])
  const [threadStatusSummaries, setThreadStatusSummaries] = useState<
    Record<number, StatusSummary | undefined>
  >({})
  const [threadScopes, setThreadScopes] = useState<
    Record<number, ThreadScopeSnapshot | undefined>
  >({})
  const [threadSubjectMatrices, setThreadSubjectMatrices] = useState<
    Record<number, readonly ThreadSubjectCellSnapshot[] | undefined>
  >({})
  const [commitments, setCommitments] = useState<CommitmentSnapshot[]>([])
  const [threadCommitments, setThreadCommitments] = useState<
    Record<number, readonly CommitmentSnapshot[] | undefined>
  >({})
  const threadProjectionRequest = useRef(0)
  const goalDocument = useDurableRichText(
    { type: 'focus', id: focus.id, field: 'goal' },
    focus.goal
  )
  const descriptionDocument = useDurableRichText(
    { type: 'focus', id: focus.id, field: 'description' },
    focus.description ?? ''
  )
  const commitmentList = buildCommitmentListModel(commitments)

  function applyFocusThreadWorkspaceData(data: FocusThreadWorkspaceData): void {
    setThreads(data.threads)
    setThreadStatusSummaries(Object.fromEntries(
      data.projections.map((entry) => [entry.threadId, entry.summary])
    ))
    setThreadCommitments(Object.fromEntries(
      data.projections.map((entry) => [entry.threadId, entry.commitments])
    ))
    setThreadScopes(Object.fromEntries(
      data.projections.map((entry) => [entry.threadId, entry.scope])
    ))
    setThreadSubjectMatrices(Object.fromEntries(
      data.projections.map((entry) => [entry.threadId, entry.subjectMatrix])
    ))
  }

  useEffect(() => {
    let active = true
    const requestId = ++threadProjectionRequest.current

    Promise.all([
      loadFocusThreadWorkspaceData(focus.id),
      window.onmove.domain.listCommitments({ type: 'focus', id: focus.id })
    ]).then(
      ([threadData, nextCommitments]) => {
        if (!active) return
        if (requestId === threadProjectionRequest.current) {
          applyFocusThreadWorkspaceData(threadData)
        }
        setCommitments(nextCommitments)
      },
      () => active && setLoadError('The focus workspace could not be loaded.')
    )

    return () => {
      active = false
    }
  }, [focus.id])

  useEffect(() => subscribeToUpdateCreated(({ focusId }) => {
    if (focusId !== focus.id) return
    const requestId = ++threadProjectionRequest.current
    void Promise.all([
      loadFocusThreadWorkspaceData(focus.id),
      window.onmove.domain.listCommitments({ type: 'focus', id: focus.id })
    ]).then(([threadData, nextCommitments]) => {
      if (requestId !== threadProjectionRequest.current) return
      applyFocusThreadWorkspaceData(threadData)
      setCommitments(nextCommitments)
    }).catch(() => setLoadError('The Update was added, but this workspace could not refresh.'))
  }), [focus.id])

  useEffect(() => {
    let active = true
    window.onmove.domain.getFocusScope(focus.id).then(
      (nextScope) => {
        if (!active) return
        setFocusScope(nextScope)
        setFocusScopeLoading(false)
      },
      () => {
        if (!active) return
        setFocusScopeError('The Focus scope could not be loaded.')
        setFocusScopeLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [focus.id])

  function changeGoal(nextGoal: string): void {
    goalDocument.save(nextGoal)
  }

  async function saveGoal(nextGoal = goalDocument.value): Promise<void> {
    goalDocument.save(nextGoal)
  }

  async function refreshFocusScopeDependents(): Promise<void> {
    const requestId = ++threadProjectionRequest.current
    const data = await loadFocusThreadWorkspaceData(focus.id)
    if (requestId !== threadProjectionRequest.current) return
    applyFocusThreadWorkspaceData(data)
  }

  async function mutateFocusScope(
    operation: () => Promise<FocusScopeSnapshot>,
    mutationError: string
  ): Promise<void> {
    setFocusScopeSaving(true)
    setFocusScopeError(null)
    let nextScope: FocusScopeSnapshot
    try {
      nextScope = await operation()
    } catch (error) {
      setFocusScopeError(mutationError)
      setFocusScopeSaving(false)
      throw error
    }

    setFocusScope(nextScope)
    try {
      await refreshFocusScopeDependents()
    } catch {
      setFocusScopeError('The Focus changed, but its Thread views could not be refreshed.')
    } finally {
      setFocusScopeSaving(false)
    }
  }

  async function addFocusScopeSubject(name: string): Promise<void> {
    await mutateFocusScope(
      () => window.onmove.domain.addFocusScopeSubject(focus.id, { name }),
      'The Subject could not be added to this Focus.'
    )
  }

  async function removeFocusScopeSubject(subjectId: number): Promise<void> {
    await mutateFocusScope(
      () => window.onmove.domain.removeFocusScopeSubject(focus.id, subjectId),
      'The Subject could not be removed from this Focus.'
    )
  }

  async function createThread(input: CreateThreadInput): Promise<ThreadSnapshot> {
    const created = await window.onmove.domain.createThread(input)
    const [scope, subjectMatrix] = await Promise.all([
      window.onmove.domain.getThreadScope(created.id),
      window.onmove.domain.getThreadSubjectMatrix(created.id)
    ])
    setThreads((current) => [...current, created])
    setThreadScopes((current) => ({ ...current, [created.id]: scope }))
    setThreadSubjectMatrices((current) => ({ ...current, [created.id]: subjectMatrix }))
    setThreadCommitments((current) => ({ ...current, [created.id]: [] }))
    setThreadStatusSummaries((current) => ({
      ...current,
      [created.id]: EMPTY_STATUS_SUMMARY
    }))
    return created
  }

  async function updateThread(
    id: number,
    input: UpdateThreadInput
  ): Promise<ThreadSnapshot> {
    const updated = await window.onmove.domain.updateThread(id, input)
    setThreads((current) =>
      current.map((thread) => (thread.id === updated.id ? updated : thread))
    )
    return updated
  }

  async function deleteThread(id: number): Promise<boolean> {
    const deleted = await window.onmove.domain.deleteThread(id)
    if (!deleted) return false
    setThreads((current) => current.filter((thread) => thread.id !== id))
    setThreadScopes((current) => withoutRecordKey(current, id))
    setThreadSubjectMatrices((current) => withoutRecordKey(current, id))
    setThreadCommitments((current) => withoutRecordKey(current, id))
    setThreadStatusSummaries((current) => withoutRecordKey(current, id))
    return true
  }

  function planThreadMove(id: number, focusId: number): Promise<ThreadMovePlanSnapshot> {
    return window.onmove.domain.planThreadMove(id, focusId)
  }

  async function moveThread(id: number, input: MoveThreadInput): Promise<ThreadSnapshot> {
    const moved = await window.onmove.domain.moveThread(id, input)
    setThreads((current) => current.filter((thread) => thread.id !== id))
    setThreadScopes((current) => withoutRecordKey(current, id))
    setThreadSubjectMatrices((current) => withoutRecordKey(current, id))
    setThreadCommitments((current) => withoutRecordKey(current, id))
    setThreadStatusSummaries((current) => withoutRecordKey(current, id))
    return moved
  }

  async function mutateThreadScope(
    threadId: number,
    operation: () => Promise<ThreadScopeSnapshot>
  ): Promise<ThreadScopeSnapshot> {
    const nextScope = await operation()
    await refreshThreadData(threadId, nextScope)
    return nextScope
  }

  function customizeThreadScope(threadId: number): Promise<ThreadScopeSnapshot> {
    return mutateThreadScope(
      threadId,
      () => window.onmove.domain.customizeThreadScope(threadId)
    )
  }

  function followFocusThreadScope(threadId: number): Promise<ThreadScopeSnapshot> {
    return mutateThreadScope(
      threadId,
      () => window.onmove.domain.followFocusThreadScope(threadId)
    )
  }

  function addThreadScopeSubject(
    threadId: number,
    name: string
  ): Promise<ThreadScopeSnapshot> {
    return mutateThreadScope(
      threadId,
      () => window.onmove.domain.addThreadScopeSubject(threadId, { name })
    )
  }

  function removeThreadScopeSubject(
    threadId: number,
    subjectId: number
  ): Promise<ThreadScopeSnapshot> {
    return mutateThreadScope(
      threadId,
      () => window.onmove.domain.removeThreadScopeSubject(threadId, subjectId)
    )
  }

  async function createCommitment(
    input: CreateCommitmentInput
  ): Promise<CommitmentSnapshot> {
    const created = await window.onmove.domain.createCommitment(input)
    if (created.parent.type === 'focus') {
      setCommitments((current) => [...current, created])
    } else {
      setThreadCommitments((current) => ({
        ...current,
        [created.parent.id]: [...(current[created.parent.id] ?? []), created]
      }))
      setThreadStatusSummaries((current) => ({
        ...current,
        [created.parent.id]: summaryWithCommitment(current[created.parent.id], created)
      }))
    }
    return created
  }

  function createRoutine(input: CreateRoutineInput): Promise<RoutineSnapshot> {
    return window.onmove.domain.createRoutine(input)
  }

  async function updateCommitment(
    id: number,
    input: UpdateCommitmentInput
  ): Promise<CommitmentSnapshot> {
    const updated = await window.onmove.domain.updateCommitment(id, input)
    if (updated.parent.type === 'focus') {
      setCommitments((current) =>
        current.map((commitment) => (commitment.id === updated.id ? updated : commitment))
      )
    } else {
      setThreadCommitments((current) => ({
        ...current,
        [updated.parent.id]: (current[updated.parent.id] ?? []).map((commitment) =>
          commitment.id === updated.id ? updated : commitment
        )
      }))
      setThreadStatusSummaries((current) => ({
        ...current,
        [updated.parent.id]: summaryWithCommitment(current[updated.parent.id], updated)
      }))
    }
    return updated
  }

  function planCommitmentMove(
    id: number,
    parent: CommitmentParent
  ): Promise<CommitmentMovePlanSnapshot> {
    return window.onmove.domain.planCommitmentMove(id, parent)
  }

  async function moveCommitment(
    id: number,
    input: MoveCommitmentInput
  ): Promise<CommitmentSnapshot> {
    const moved = await window.onmove.domain.moveCommitment(id, input)
    const requestId = ++threadProjectionRequest.current
    const [threadData, nextCommitments, nextFocusScope] = await Promise.all([
      loadFocusThreadWorkspaceData(focus.id),
      window.onmove.domain.listCommitments({ type: 'focus', id: focus.id }),
      window.onmove.domain.getFocusScope(focus.id)
    ])
    if (requestId === threadProjectionRequest.current) {
      applyFocusThreadWorkspaceData(threadData)
    }
    setCommitments(nextCommitments)
    setFocusScope(nextFocusScope)
    return moved
  }

  async function deleteCommitment(id: number): Promise<boolean> {
    const parent = commitments.find((commitment) => commitment.id === id)?.parent ??
      Object.values(threadCommitments)
        .flatMap((items) => items ?? [])
        .find((commitment) => commitment.id === id)
        ?.parent
    const deleted = await window.onmove.domain.deleteCommitment(id)
    if (!deleted) return false

    setCommitments((current) => current.filter((commitment) => commitment.id !== id))
    setThreadCommitments((current) => Object.fromEntries(
      Object.entries(current).map(([threadId, items]) => [
        threadId,
        items?.filter((commitment) => commitment.id !== id)
      ])
    ))
    if (parent?.type === 'thread') {
      setThreadStatusSummaries((current) => ({
        ...current,
        [parent.id]: summaryWithoutCommitment(current[parent.id], id)
      }))
    }
    return true
  }

  function commitmentsFor(parent: CommitmentParent): readonly CommitmentSnapshot[] {
    return parent.type === 'focus' ? commitments : (threadCommitments[parent.id] ?? [])
  }

  async function refreshThreadData(
    threadId: number,
    knownScope?: ThreadScopeSnapshot
  ): Promise<ThreadSnapshot> {
    const [nextThreads, nextCommitments, updates, scope, subjectMatrix] = await Promise.all([
      window.onmove.domain.listThreads(focus.id),
      window.onmove.domain.listCommitments({ type: 'thread', id: threadId }),
      window.onmove.domain.listUpdates({ type: 'thread', id: threadId }),
      knownScope ?? window.onmove.domain.getThreadScope(threadId),
      window.onmove.domain.getThreadSubjectMatrix(threadId)
    ])
    const refreshed = nextThreads.find((thread) => thread.id === threadId)
    if (!refreshed) throw new Error('Thread no longer exists')
    setThreads(nextThreads)
    setThreadCommitments((current) => ({ ...current, [threadId]: nextCommitments }))
    setThreadScopes((current) => ({ ...current, [threadId]: scope }))
    setThreadSubjectMatrices((current) => ({ ...current, [threadId]: subjectMatrix }))
    setThreadStatusSummaries((current) => ({
      ...current,
      [threadId]: buildStatusSummary(updates, nextCommitments)
    }))
    return refreshed
  }

  function refreshThread(threadId: number): Promise<ThreadSnapshot> {
    return refreshThreadData(threadId)
  }

  async function refreshCommitments(
    parent: CommitmentParent = { type: 'focus', id: focus.id }
  ): Promise<void> {
    if (parent.type === 'thread') {
      await refreshThread(parent.id)
      return
    }
    const nextCommitments = await window.onmove.domain.listCommitments(parent)
    setCommitments(nextCommitments)
  }

  return {
    goal: goalDocument.value,
    setGoal: changeGoal,
    goalSaving: goalDocument.saving,
    goalRevision: goalDocument.revision,
    goalError: goalDocument.error,
    focusScope,
    focusScopeLoading,
    focusScopeSaving,
    focusScopeError,
    loadError,
    threads,
    threadScopes,
    threadSubjectMatrices,
    threadStatusSummaries,
    commitments,
    threadCommitments,
    commitmentList,
    commitmentsFor,
    saveGoal,
    openGoalInWindow: goalDocument.openInWindow,
    saveDescription: descriptionDocument.save,
    openDescriptionInWindow: descriptionDocument.openInWindow,
    addFocusScopeSubject,
    removeFocusScopeSubject,
    createThread,
    updateThread,
    planThreadMove,
    moveThread,
    deleteThread,
    customizeThreadScope,
    followFocusThreadScope,
    addThreadScopeSubject,
    removeThreadScopeSubject,
    createCommitment,
    createRoutine,
    updateCommitment,
    planCommitmentMove,
    moveCommitment,
    deleteCommitment,
    refreshCommitments,
    refreshThread
  }
}
