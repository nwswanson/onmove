import { useEffect, useState } from 'react'
import type {
  CommitmentSnapshot,
  CreateCommitmentInput,
  CreateThreadInput,
  FocusSnapshot,
  ThreadSnapshot,
  UpdateFocusInput
} from '../../../../shared/contracts'
import { useThrottledAutosave } from '@/lib/use-throttled-autosave'

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
  commitments: CommitmentSnapshot[]
  saveGoal: (goal?: string) => Promise<void>
  createThread: (input: CreateThreadInput) => Promise<ThreadSnapshot>
  createCommitment: (input: CreateCommitmentInput) => Promise<CommitmentSnapshot>
  refreshCommitments: () => Promise<void>
}

/** Persistence-backed state and operations for a Focus workspace. */
export function useFocusWorkspaceModel({
  focus,
  onUpdateFocus
}: FocusWorkspaceModelOptions): FocusWorkspaceModel {
  const [goal, setGoal] = useState(focus.goal)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [threads, setThreads] = useState<ThreadSnapshot[]>([])
  const [commitments, setCommitments] = useState<CommitmentSnapshot[]>([])
  const goalAutosave = useThrottledAutosave({
    initialValue: focus.goal,
    onSave: (nextGoal: string) => onUpdateFocus({ goal: nextGoal })
  })

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
    return created
  }

  async function createCommitment(
    input: CreateCommitmentInput
  ): Promise<CommitmentSnapshot> {
    const created = await window.onmove.domain.createCommitment(input)
    setCommitments((current) => [...current, created])
    return created
  }

  async function refreshCommitments(): Promise<void> {
    const nextCommitments = await window.onmove.domain.listCommitments({
      type: 'focus',
      id: focus.id
    })
    setCommitments(nextCommitments)
  }

  return {
    goal,
    setGoal: changeGoal,
    goalSaving: goalAutosave.saving,
    goalError: goalAutosave.error ? 'The goal could not be saved.' : null,
    loadError,
    threads,
    commitments,
    saveGoal,
    createThread,
    createCommitment,
    refreshCommitments
  }
}
