import { useEffect, useRef, useState } from 'react'
import type {
  CommitmentParent,
  CommitmentScopeSnapshot,
  CommitmentSnapshot,
  CreateCommitmentInput,
  CreateThreadInput,
  FocusSnapshot,
  FocusScopeSnapshot,
  ThreadSnapshot,
  ThreadScopeSnapshot,
  ThreadSubjectCellSnapshot,
  UpdateFocusInput,
  UpdateCommitmentInput,
  UpdateThreadInput
} from '../../../../shared/contracts'
import { useThrottledAutosave } from '@/lib/use-throttled-autosave'
import {
  buildCommitmentListModel,
  type CommitmentListModel
} from '@/features/focus/commitment-list-model'
import {
  buildStatusSummary,
  EMPTY_STATUS_SUMMARY,
  type StatusSummary
} from '@/features/shared/status-summary'

interface FocusWorkspaceModelOptions {
  focus: FocusSnapshot
  onUpdateFocus: (input: UpdateFocusInput) => Promise<void>
}

export interface FocusWorkspaceModel {
  goal: string
  setGoal: (goal: string) => void
  goalSaving: boolean
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
  commitmentScopes: Readonly<Record<number, CommitmentScopeSnapshot | undefined>>
  commitmentList: CommitmentListModel
  commitmentsFor: (parent: CommitmentParent) => readonly CommitmentSnapshot[]
  saveGoal: (goal?: string) => Promise<void>
  addFocusScopeSubject: (name: string) => Promise<void>
  removeFocusScopeSubject: (subjectId: number) => Promise<void>
  createThread: (input: CreateThreadInput) => Promise<ThreadSnapshot>
  updateThread: (id: number, input: UpdateThreadInput) => Promise<ThreadSnapshot>
  deleteThread: (id: number) => Promise<boolean>
  customizeThreadScope: (threadId: number) => Promise<ThreadScopeSnapshot>
  followFocusThreadScope: (threadId: number) => Promise<ThreadScopeSnapshot>
  addThreadScopeSubject: (threadId: number, name: string) => Promise<ThreadScopeSnapshot>
  removeThreadScopeSubject: (
    threadId: number,
    subjectId: number
  ) => Promise<ThreadScopeSnapshot>
  createCommitment: (input: CreateCommitmentInput) => Promise<CommitmentSnapshot>
  updateCommitment: (id: number, input: UpdateCommitmentInput) => Promise<CommitmentSnapshot>
  deleteCommitment: (id: number) => Promise<boolean>
  customizeCommitmentScope: (commitmentId: number) => Promise<CommitmentScopeSnapshot>
  followParentCommitmentScope: (commitmentId: number) => Promise<CommitmentScopeSnapshot>
  addCommitmentScopeSubject: (
    commitmentId: number,
    name: string
  ) => Promise<CommitmentScopeSnapshot>
  removeCommitmentScopeSubject: (
    commitmentId: number,
    subjectId: number
  ) => Promise<CommitmentScopeSnapshot>
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
  commitmentScopes: CommitmentScopeSnapshot[]
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
      const commitmentScopes = await Promise.all(
        commitments.map(({ id }) => window.onmove.domain.getCommitmentScope(id))
      )
      return {
        threadId: thread.id,
        commitments,
        summary: buildStatusSummary(updates, commitments),
        scope,
        subjectMatrix,
        commitmentScopes
      }
    })
  )
  return { threads, projections }
}

/** Persistence-backed state and operations for a Focus workspace. */
export function useFocusWorkspaceModel({
  focus,
  onUpdateFocus
}: FocusWorkspaceModelOptions): FocusWorkspaceModel {
  const [goal, setGoal] = useState(focus.goal)
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
  const [commitmentScopes, setCommitmentScopes] = useState<
    Record<number, CommitmentScopeSnapshot | undefined>
  >({})
  const threadProjectionRequest = useRef(0)
  const goalAutosave = useThrottledAutosave({
    initialValue: focus.goal,
    onSave: (nextGoal: string) => onUpdateFocus({ goal: nextGoal })
  })
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
    const nextThreadScopes = data.projections.flatMap((entry) => entry.commitmentScopes)
    setCommitmentScopes((current) => ({
      ...Object.fromEntries(
        Object.entries(current).filter(([, scope]) => scope?.parent.type !== 'thread')
      ),
      ...Object.fromEntries(nextThreadScopes.map((scope) => [scope.commitmentId, scope]))
    }))
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
    const normalizedGoal = nextGoal.trim()
    setGoal(normalizedGoal)
    goalAutosave.schedule(normalizedGoal)
  }

  async function saveGoal(nextGoal = goal): Promise<void> {
    const normalizedGoal = nextGoal.trim()
    setGoal(normalizedGoal)
    await goalAutosave.flush(normalizedGoal)
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
      const scope = await window.onmove.domain.getCommitmentScope(created.id)
      setThreadCommitments((current) => ({
        ...current,
        [created.parent.id]: [...(current[created.parent.id] ?? []), created]
      }))
      setThreadStatusSummaries((current) => ({
        ...current,
        [created.parent.id]: summaryWithCommitment(current[created.parent.id], created)
      }))
      setCommitmentScopes((current) => ({ ...current, [created.id]: scope }))
    }
    return created
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
    setCommitmentScopes((current) => withoutRecordKey(current, id))
    if (parent?.type === 'thread') {
      setThreadStatusSummaries((current) => ({
        ...current,
        [parent.id]: summaryWithoutCommitment(current[parent.id], id)
      }))
    }
    return true
  }

  async function mutateCommitmentScope(
    commitmentId: number,
    operation: () => Promise<CommitmentScopeSnapshot>
  ): Promise<CommitmentScopeSnapshot> {
    const nextScope = await operation()
    setCommitmentScopes((current) => ({
      ...current,
      [commitmentId]: nextScope
    }))
    if (nextScope.parent.type === 'thread') await refreshThreadData(nextScope.parent.id)
    return nextScope
  }

  function customizeCommitmentScope(
    commitmentId: number
  ): Promise<CommitmentScopeSnapshot> {
    return mutateCommitmentScope(
      commitmentId,
      () => window.onmove.domain.customizeCommitmentScope(commitmentId)
    )
  }

  function followParentCommitmentScope(
    commitmentId: number
  ): Promise<CommitmentScopeSnapshot> {
    return mutateCommitmentScope(
      commitmentId,
      () => window.onmove.domain.followParentCommitmentScope(commitmentId)
    )
  }

  function addCommitmentScopeSubject(
    commitmentId: number,
    name: string
  ): Promise<CommitmentScopeSnapshot> {
    return mutateCommitmentScope(
      commitmentId,
      () => window.onmove.domain.addCommitmentScopeSubject(commitmentId, { name })
    )
  }

  function removeCommitmentScopeSubject(
    commitmentId: number,
    subjectId: number
  ): Promise<CommitmentScopeSnapshot> {
    return mutateCommitmentScope(
      commitmentId,
      () => window.onmove.domain.removeCommitmentScopeSubject(commitmentId, subjectId)
    )
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
    const nextCommitmentScopes = await Promise.all(
      nextCommitments.map(({ id }) => window.onmove.domain.getCommitmentScope(id))
    )
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
    setCommitmentScopes((current) => ({
      ...Object.fromEntries(
        Object.entries(current).filter(([, candidate]) =>
          candidate?.parent.type !== 'thread' || candidate.parent.id !== threadId
        )
      ),
      ...Object.fromEntries(nextCommitmentScopes.map((candidate) => [
        candidate.commitmentId,
        candidate
      ]))
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
    goal,
    setGoal: changeGoal,
    goalSaving: goalAutosave.saving,
    goalError: goalAutosave.error ? 'The goal could not be saved.' : null,
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
    commitmentScopes,
    commitmentList,
    commitmentsFor,
    saveGoal,
    addFocusScopeSubject,
    removeFocusScopeSubject,
    createThread,
    updateThread,
    deleteThread,
    customizeThreadScope,
    followFocusThreadScope,
    addThreadScopeSubject,
    removeThreadScopeSubject,
    createCommitment,
    updateCommitment,
    deleteCommitment,
    customizeCommitmentScope,
    followParentCommitmentScope,
    addCommitmentScopeSubject,
    removeCommitmentScopeSubject,
    refreshCommitments,
    refreshThread
  }
}
