import { useEffect, useState } from 'react'
import type {
  DueOverviewSnapshot,
  DueWorkItemSnapshot,
  FocusStatus
} from '../../../../shared/contracts'

interface DueModelOptions {
  onWorkChanged?: (focusId: number) => void | Promise<void>
}

export interface DueModel {
  overview: DueOverviewSnapshot | null
  loading: boolean
  error: string | null
  pendingKeys: ReadonlySet<string>
  changeDueDate: (key: string, dueDate: string | null) => Promise<boolean>
  changeStatus: (key: string, status: FocusStatus) => Promise<boolean>
  refresh: () => Promise<void>
}

async function persistDueDate(
  item: DueWorkItemSnapshot,
  dueDate: string | null
): Promise<void> {
  if (item.kind === 'focus') {
    await window.onmove.domain.updateFocus(item.focus.id, { dueDate })
  } else if (item.kind === 'thread' && item.thread) {
    await window.onmove.domain.updateThread(item.thread.id, { dueDate })
  } else if (item.commitment) {
    await window.onmove.domain.updateCommitment(item.commitment.id, { dueDate })
  }
}

async function persistStatus(
  item: DueWorkItemSnapshot,
  status: FocusStatus
): Promise<void> {
  if (item.kind === 'focus') {
    await window.onmove.domain.updateFocus(item.focus.id, { status })
  } else if (item.kind === 'thread' && item.thread) {
    await window.onmove.domain.updateThread(item.thread.id, { status })
  } else if (item.commitment) {
    await window.onmove.domain.updateCommitment(item.commitment.id, { status })
  }
}

/** Owns persistence and refresh semantics for the global due-work projection. */
export function useDueModel({ onWorkChanged }: DueModelOptions = {}): DueModel {
  const [overview, setOverview] = useState<DueOverviewSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set())

  async function refresh(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      setOverview(await window.onmove.domain.getDueOverview())
    } catch {
      setError('Due work could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    window.onmove.domain.getDueOverview().then(
      (next) => {
        if (!active) return
        setOverview(next)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Due work could not be loaded.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(() => window.onmove.onDomainChanged(() => {
    void window.onmove.domain.getDueOverview().then((next) => {
      setOverview(next)
      setError(null)
    }).catch(() => undefined)
  }), [])

  async function mutate(
    key: string,
    operation: (item: DueWorkItemSnapshot) => Promise<void>,
    failure: string
  ): Promise<boolean> {
    const item = overview?.items.find((candidate) => candidate.key === key)
    if (!item) return false
    setPendingKeys((current) => new Set([...current, key]))
    setError(null)
    try {
      await operation(item)
      setOverview(await window.onmove.domain.getDueOverview())
      try {
        await onWorkChanged?.(item.focus.id)
      } catch {
        // The aggregate mutation is committed; application-shell summaries can refresh later.
      }
      return true
    } catch {
      setError(failure)
      return false
    } finally {
      setPendingKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  return {
    overview,
    loading,
    error,
    pendingKeys,
    changeDueDate: (key, dueDate) => mutate(
      key,
      (item) => persistDueDate(item, dueDate),
      'The due date could not be changed.'
    ),
    changeStatus: (key, status) => mutate(
      key,
      (item) => persistStatus(item, status),
      'The status could not be changed.'
    ),
    refresh
  }
}
