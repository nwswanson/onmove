import { useEffect, useState } from 'react'
import type {
  CommitmentSnapshot,
  CreateCommitmentInput,
  CreateThreadInput,
  FocusSnapshot,
  ThreadSnapshot,
  UpdateFocusInput
} from '../../../../shared/contracts'

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
  saveGoal: () => Promise<void>
  createThread: (input: CreateThreadInput) => Promise<ThreadSnapshot>
  createCommitment: (input: CreateCommitmentInput) => Promise<CommitmentSnapshot>
}

/** Persistence-backed state and operations for a Focus workspace. */
export function useFocusWorkspaceModel({
  focus,
  onUpdateFocus
}: FocusWorkspaceModelOptions): FocusWorkspaceModel {
  const [goal, setGoal] = useState(focus.goal)
  const [goalSaving, setGoalSaving] = useState(false)
  const [goalError, setGoalError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [threads, setThreads] = useState<ThreadSnapshot[]>([])
  const [commitments, setCommitments] = useState<CommitmentSnapshot[]>([])

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

  return {
    goal,
    setGoal,
    goalSaving,
    goalError,
    loadError,
    threads,
    commitments,
    saveGoal,
    createThread,
    createCommitment
  }
}
