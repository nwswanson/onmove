import { useEffect, useState } from 'react'
import type { ArchivedUpdateOverviewSnapshot } from '../../../../shared/contracts'

export interface ArchiveModel {
  overview: ArchivedUpdateOverviewSnapshot | null
  loading: boolean
  error: string | null
  pendingIds: ReadonlySet<string>
  clearing: boolean
  deleteItem: (archiveId: string) => Promise<boolean>
  clearAll: () => Promise<boolean>
  refresh: () => Promise<void>
}

/** Owns preload access and destructive archive lifecycle mutations. */
export function useArchiveModel(): ArchiveModel {
  const [overview, setOverview] = useState<ArchivedUpdateOverviewSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [clearing, setClearing] = useState(false)

  async function refresh(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      setOverview(await window.onmove.domain.getArchivedUpdateOverview())
    } catch {
      setError('Archived updates could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    window.onmove.domain.getArchivedUpdateOverview().then(
      (next) => {
        if (!active) return
        setOverview(next)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Archived updates could not be loaded.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [])

  async function deleteItem(archiveId: string): Promise<boolean> {
    setPendingIds((current) => new Set(current).add(archiveId))
    setError(null)
    try {
      const deleted = await window.onmove.domain.deleteArchivedUpdate(archiveId)
      if (!deleted) {
        setOverview(await window.onmove.domain.getArchivedUpdateOverview())
        return false
      }
      setOverview((current) => current === null
        ? current
        : { ...current, items: current.items.filter(({ archiveId: id }) => id !== archiveId) })
      return true
    } catch {
      setError('The archived update could not be permanently deleted.')
      return false
    } finally {
      setPendingIds((current) => {
        const next = new Set(current)
        next.delete(archiveId)
        return next
      })
    }
  }

  async function clearAll(): Promise<boolean> {
    setClearing(true)
    setError(null)
    try {
      await window.onmove.domain.clearArchivedUpdates()
      setOverview((current) => current === null ? current : { ...current, items: [] })
      return true
    } catch {
      setError('The archive could not be cleared.')
      return false
    } finally {
      setClearing(false)
    }
  }

  return {
    overview,
    loading,
    error,
    pendingIds,
    clearing,
    deleteItem,
    clearAll,
    refresh
  }
}
