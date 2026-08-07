import { useEffect, useState } from 'react'
import type {
  CreateUpdateInput,
  EditUpdateInput,
  UpdateParent,
  UpdateSnapshot
} from '../../../../shared/contracts'

function sortUpdates(updates: readonly UpdateSnapshot[]): UpdateSnapshot[] {
  return [...updates].sort((left, right) =>
    left.date === right.date ? right.id - left.id : right.date.localeCompare(left.date)
  )
}

function updateParent(type: UpdateParent['type'], id: number): UpdateParent {
  if (type === 'focus') return { type, id }
  if (type === 'thread') return { type, id }
  return { type, id }
}

export interface UpdatesModel {
  updates: UpdateSnapshot[]
  loading: boolean
  loadError: string | null
  createUpdate: (
    input: Omit<CreateUpdateInput, 'parent'>
  ) => Promise<UpdateSnapshot>
  editUpdate: (id: number, input: EditUpdateInput) => Promise<UpdateSnapshot>
  deleteUpdate: (id: number) => Promise<void>
}

/** Persistence-backed operations for direct Updates on one typed domain parent. */
export function useUpdatesModel(parent: UpdateParent): UpdatesModel {
  const parentType = parent.type
  const parentId = parent.id
  const [updates, setUpdates] = useState<UpdateSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.onmove.domain.listUpdates(updateParent(parentType, parentId)).then(
      (nextUpdates) => {
        if (!active) return
        setUpdates(sortUpdates(nextUpdates))
        setLoading(false)
      },
      () => {
        if (!active) return
        setLoadError('Updates could not be loaded.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [parentId, parentType])

  async function createUpdate(
    input: Omit<CreateUpdateInput, 'parent'>
  ): Promise<UpdateSnapshot> {
    const created = await window.onmove.domain.createUpdate({
      ...input,
      parent: updateParent(parentType, parentId)
    })
    setUpdates((current) => sortUpdates([...current, created]))
    return created
  }

  async function editUpdate(id: number, input: EditUpdateInput): Promise<UpdateSnapshot> {
    const updated = await window.onmove.domain.updateUpdate(id, input)
    setUpdates((current) =>
      sortUpdates(current.map((candidate) => (candidate.id === id ? updated : candidate)))
    )
    return updated
  }

  async function deleteUpdate(id: number): Promise<void> {
    const deleted = await window.onmove.domain.deleteUpdate(id)
    if (!deleted) throw new Error('Update no longer exists')
    setUpdates((current) => current.filter((candidate) => candidate.id !== id))
  }

  return { updates, loading, loadError, createUpdate, editUpdate, deleteUpdate }
}
