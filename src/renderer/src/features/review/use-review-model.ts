import { useEffect, useRef, useState } from 'react'
import type {
  EditUpdateInput,
  ReviewOverviewSnapshot,
  ReviewQueueItemSnapshot,
  UpdateParent,
  UpdateSnapshot
} from '../../../../shared/contracts'

export interface ReviewModel {
  overview: ReviewOverviewSnapshot | null
  loading: boolean
  error: string | null
  dismissedKeys: ReadonlySet<string>
  reviewedKeys: ReadonlySet<string>
  pendingKey: string | null
  editingUpdate: { itemKey: string; update: UpdateSnapshot } | null
  ignore: (itemKey: string) => void
  pass: (item: ReviewQueueItemSnapshot) => Promise<void>
  recordTodoMutation: (item: ReviewQueueItemSnapshot) => Promise<void>
  recordNoteMutation: (item: ReviewQueueItemSnapshot) => Promise<void>
  beginUpdate: (item: ReviewQueueItemSnapshot) => Promise<void>
  editUpdate: (input: EditUpdateInput) => Promise<void>
  saveObservation: (value: string) => void
  openObservation: () => void
  cancelUpdate: () => void
  finishUpdate: () => void
  refresh: () => Promise<void>
}

interface ReviewModelOptions {
  onReviewChanged?: (focusId: number) => void | Promise<void>
}

function itemParent(item: ReviewQueueItemSnapshot): UpdateParent {
  if (item.kind === 'focus') return { type: 'focus', id: item.focus.id }
  if (item.kind === 'thread') {
    if (!item.thread) throw new Error('A Thread review item requires a Thread')
    return { type: 'thread', id: item.thread.id }
  }
  if (!item.commitment) throw new Error('A Commitment review item requires a Commitment')
  return { type: 'commitment', id: item.commitment.id }
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

/** Owns the queue session and all persistence-backed review actions. */
export function useReviewModel({ onReviewChanged }: ReviewModelOptions = {}): ReviewModel {
  const [overview, setOverview] = useState<ReviewOverviewSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(new Set())
  const [reviewedKeys, setReviewedKeys] = useState<ReadonlySet<string>>(new Set())
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [editingUpdate, setEditingUpdate] = useState<{
    itemKey: string
    update: UpdateSnapshot
  } | null>(null)
  const notePokedKeysRef = useRef(new Set<string>())

  async function refresh(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const next = await window.onmove.domain.getReviewOverview()
      const retainedReviews = overview?.asOf === next.asOf ? reviewedKeys : new Set<string>()
      setOverview(next)
      setReviewedKeys(retainedReviews)
      setDismissedKeys(retainedReviews)
      setEditingUpdate(null)
      notePokedKeysRef.current.clear()
    } catch {
      setError('Review work could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    window.onmove.domain.getReviewOverview().then(
      (next) => {
        if (!active) return
        setOverview(next)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Review work could not be loaded.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [])

  function dismiss(itemKey: string): void {
    setDismissedKeys((current) => new Set([...current, itemKey]))
  }

  function complete(itemKey: string): void {
    setReviewedKeys((current) => new Set([...current, itemKey]))
    dismiss(itemKey)
  }

  function ignore(itemKey: string): void {
    setError(null)
    dismiss(itemKey)
  }

  async function notifyReviewChanged(focusId: number): Promise<void> {
    try {
      await onReviewChanged?.(focusId)
    } catch {
      // Persistence already succeeded. A background projection refresh can be
      // retried by the owning application model without reopening this item.
    }
  }

  async function persistPoke(item: ReviewQueueItemSnapshot): Promise<void> {
    if (item.kind === 'focus') {
      await window.onmove.domain.pokeFocusReview(item.focus.id)
    } else if (item.kind === 'thread' && item.thread) {
      if (item.cell) {
        await window.onmove.domain.pokeThreadReview(item.thread.id, {
          scopeId: item.cell.scopeId,
          subjectId: item.cell.subjectId
        })
      } else {
        await window.onmove.domain.pokeThreadReview(item.thread.id)
      }
    } else if (item.commitment) {
      if (item.cell) {
        await window.onmove.domain.pokeCommitmentReview(item.commitment.id, {
          scopeId: item.cell.scopeId,
          subjectId: item.cell.subjectId
        })
      } else {
        await window.onmove.domain.pokeCommitmentReview(item.commitment.id)
      }
    }
  }

  async function pass(item: ReviewQueueItemSnapshot): Promise<void> {
    setPendingKey(item.key)
    setError(null)
    try {
      await persistPoke(item)
      complete(item.key)
      await notifyReviewChanged(item.focus.id)
    } catch {
      setError('The review could not be passed along.')
    } finally {
      setPendingKey(null)
    }
  }

  async function recordTodoMutation(item: ReviewQueueItemSnapshot): Promise<void> {
    setPendingKey(item.key)
    setError(null)
    try {
      await persistPoke(item)
      setOverview((current) => current
        ? {
            ...current,
            items: current.items.map((candidate) => candidate.key === item.key
              ? {
                  ...candidate,
                  lastReviewDate: current.asOf,
                  due: candidate.kind === 'commitment' ? candidate.due : false,
                  nextReviewDate: candidate.kind === 'thread' && candidate.thread
                    ? addDays(current.asOf, candidate.thread.reviewFrequencyDays)
                    : candidate.nextReviewDate
                }
              : candidate)
          }
        : current)
      await notifyReviewChanged(item.focus.id)
    } catch {
      setError('The Todo was saved, but its review acknowledgement could not be recorded.')
    } finally {
      setPendingKey(null)
    }
  }

  async function recordNoteMutation(item: ReviewQueueItemSnapshot): Promise<void> {
    if (notePokedKeysRef.current.has(item.key)) return
    // Rich-text changes can arrive faster than the IPC round trip. Reserve the
    // key synchronously so one typing session records one durable review poke.
    notePokedKeysRef.current.add(item.key)
    setError(null)
    try {
      await persistPoke(item)
      setOverview((current) => current
        ? {
            ...current,
            items: current.items.map((candidate) => candidate.key === item.key
              ? {
                  ...candidate,
                  lastReviewDate: current.asOf,
                  nextReviewDate: candidate.kind === 'thread' && candidate.thread
                    ? addDays(current.asOf, candidate.thread.reviewFrequencyDays)
                    : candidate.nextReviewDate
                }
              : candidate)
          }
        : current)
      await notifyReviewChanged(item.focus.id)
    } catch {
      notePokedKeysRef.current.delete(item.key)
      setError('The Note was saved, but its review acknowledgement could not be recorded.')
    }
  }

  async function beginUpdate(item: ReviewQueueItemSnapshot): Promise<void> {
    setPendingKey(item.key)
    setError(null)
    try {
      const update = await window.onmove.domain.createUpdate({
        parent: itemParent(item),
        date: overview?.asOf,
        observation: '',
        state: 'none',
        sensitive: false,
        ...(item.cell
          ? { scope: { scopeId: item.cell.scopeId, subjectId: item.cell.subjectId } }
          : {})
      })
      setEditingUpdate({ itemKey: item.key, update })
    } catch {
      setError('An Update could not be started for this review.')
    } finally {
      setPendingKey(null)
    }
  }

  async function editUpdate(input: EditUpdateInput): Promise<void> {
    if (!editingUpdate) return
    try {
      const update = await window.onmove.domain.updateUpdate(editingUpdate.update.id, input)
      setEditingUpdate((current) => current ? { ...current, update } : current)
      setError(null)
    } catch {
      setError('The Update could not be saved. Your review remains open.')
      throw new Error('Review Update save failed')
    }
  }

  function saveObservation(value: string): void {
    if (!editingUpdate) return
    try {
      const document = window.onmove.richText.saveDocument(
        { type: 'update', id: editingUpdate.update.id, field: 'observation' },
        value
      )
      setEditingUpdate((current) => current
        ? {
            ...current,
            update: {
              ...current.update,
              observation: document.value,
              updatedAt: document.updatedAt
            }
          }
        : current)
      setError(null)
    } catch {
      setError('The Update text could not be saved. Keep editing to retry.')
    }
  }

  function openObservation(): void {
    if (!editingUpdate) return
    void window.onmove.richText.openWindow({
      type: 'update',
      id: editingUpdate.update.id,
      field: 'observation'
    })
  }

  function cancelUpdate(): void {
    if (!editingUpdate) return
    const cancelled = editingUpdate
    // Review Updates are durable from creation onward. Cancelling only exits
    // the composer and promotes its latest autosaved snapshot into history.
    setOverview((current) => current
      ? {
          ...current,
          items: current.items.map((item) => item.key === cancelled.itemKey
            ? {
                ...item,
                updates: [
                  cancelled.update,
                  ...item.updates.filter(({ id }) => id !== cancelled.update.id)
                ]
              }
            : item)
        }
      : current)
    setEditingUpdate(null)
    setError(null)
  }

  function finishUpdate(): void {
    if (!editingUpdate) return
    const item = overview?.items.find(({ key }) => key === editingUpdate.itemKey)
    complete(editingUpdate.itemKey)
    setEditingUpdate(null)
    setError(null)
    if (item) void notifyReviewChanged(item.focus.id)
  }

  return {
    overview,
    loading,
    error,
    dismissedKeys,
    reviewedKeys,
    pendingKey,
    editingUpdate,
    ignore,
    pass,
    recordTodoMutation,
    recordNoteMutation,
    beginUpdate,
    editUpdate,
    saveObservation,
    openObservation,
    cancelUpdate,
    finishUpdate,
    refresh
  }
}
