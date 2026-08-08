import { useEffect, useState } from 'react'
import type {
  CommitmentParent,
  CommitmentSnapshot,
  CreateCommitmentInput,
  CreateThreadInput,
  FocusSnapshot,
  ThreadSnapshot,
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
  loadError: string | null
  threads: ThreadSnapshot[]
  threadStatusSummaries: Readonly<Record<number, StatusSummary | undefined>>
  commitments: CommitmentSnapshot[]
  threadCommitments: Readonly<Record<number, readonly CommitmentSnapshot[] | undefined>>
  commitmentList: CommitmentListModel
  commitmentsFor: (parent: CommitmentParent) => readonly CommitmentSnapshot[]
  saveGoal: (goal?: string) => Promise<void>
  createThread: (input: CreateThreadInput) => Promise<ThreadSnapshot>
  updateThread: (id: number, input: UpdateThreadInput) => Promise<ThreadSnapshot>
  createCommitment: (input: CreateCommitmentInput) => Promise<CommitmentSnapshot>
  updateCommitment: (id: number, input: UpdateCommitmentInput) => Promise<CommitmentSnapshot>
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

/** Persistence-backed state and operations for a Focus workspace. */
export function useFocusWorkspaceModel({
  focus,
  onUpdateFocus
}: FocusWorkspaceModelOptions): FocusWorkspaceModel {
  const [goal, setGoal] = useState(focus.goal)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [threads, setThreads] = useState<ThreadSnapshot[]>([])
  const [threadStatusSummaries, setThreadStatusSummaries] = useState<
    Record<number, StatusSummary | undefined>
  >({})
  const [commitments, setCommitments] = useState<CommitmentSnapshot[]>([])
  const [threadCommitments, setThreadCommitments] = useState<
    Record<number, readonly CommitmentSnapshot[] | undefined>
  >({})
  const goalAutosave = useThrottledAutosave({
    initialValue: focus.goal,
    onSave: (nextGoal: string) => onUpdateFocus({ goal: nextGoal })
  })
  const commitmentList = buildCommitmentListModel(commitments)

  useEffect(() => {
    let active = true

    Promise.all([
      window.onmove.domain.listThreads(focus.id),
      window.onmove.domain.listCommitments({ type: 'focus', id: focus.id })
    ]).then(
      ([nextThreads, nextCommitments]) => {
        if (!active) return
        setThreads(nextThreads)
        setCommitments(nextCommitments)
        void Promise.all(
          nextThreads.map(async (thread) => {
            try {
              const [nextCommitments, updates] = await Promise.all([
                window.onmove.domain.listCommitments({ type: 'thread', id: thread.id }),
                window.onmove.domain.listUpdates({ type: 'thread', id: thread.id })
              ])
              return {
                threadId: thread.id,
                commitments: nextCommitments,
                summary: buildStatusSummary(updates, nextCommitments)
              }
            } catch {
              return null
            }
          })
        ).then((entries) => {
          if (!active) return
          setThreadStatusSummaries(
            Object.fromEntries(
              entries
                .filter((entry) => entry !== null)
                .map((entry) => [entry.threadId, entry.summary])
            )
          )
          setThreadCommitments(
            Object.fromEntries(
              entries
                .filter((entry) => entry !== null)
                .map((entry) => [entry.threadId, entry.commitments])
            )
          )
        })
      },
      () => active && setLoadError('The focus workspace could not be loaded.')
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

  async function createThread(input: CreateThreadInput): Promise<ThreadSnapshot> {
    const created = await window.onmove.domain.createThread(input)
    setThreads((current) => [...current, created])
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

  function commitmentsFor(parent: CommitmentParent): readonly CommitmentSnapshot[] {
    return parent.type === 'focus' ? commitments : (threadCommitments[parent.id] ?? [])
  }

  async function refreshThread(threadId: number): Promise<ThreadSnapshot> {
    const [nextThreads, nextCommitments, updates] = await Promise.all([
      window.onmove.domain.listThreads(focus.id),
      window.onmove.domain.listCommitments({ type: 'thread', id: threadId }),
      window.onmove.domain.listUpdates({ type: 'thread', id: threadId })
    ])
    const refreshed = nextThreads.find((thread) => thread.id === threadId)
    if (!refreshed) throw new Error('Thread no longer exists')
    setThreads(nextThreads)
    setThreadCommitments((current) => ({ ...current, [threadId]: nextCommitments }))
    setThreadStatusSummaries((current) => ({
      ...current,
      [threadId]: buildStatusSummary(updates, nextCommitments)
    }))
    return refreshed
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
    loadError,
    threads,
    threadStatusSummaries,
    commitments,
    threadCommitments,
    commitmentList,
    commitmentsFor,
    saveGoal,
    createThread,
    updateThread,
    createCommitment,
    updateCommitment,
    refreshCommitments,
    refreshThread
  }
}
