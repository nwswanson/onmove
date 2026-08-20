import { useEffect, useRef, useState } from 'react'
import type {
  CreateUpdateInput,
  EditUpdateInput,
  UpdateParent,
  UpdateScopeCell,
  UpdateSnapshot
} from '../../../../shared/contracts'
import { subscribeToUpdateCreated } from '@/features/updates/update-creation-events'

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

export type UpdateWorkingContext =
  | { mode: 'unfiltered' }
  | { mode: 'unscoped' }
  | { mode: 'scope-overview' }
  | { mode: 'cell'; cell: UpdateScopeCell }

export function updatesForWorkingContext(
  updates: readonly UpdateSnapshot[],
  context: UpdateWorkingContext
): UpdateSnapshot[] {
  if (context.mode === 'unfiltered') return [...updates]
  if (context.mode === 'unscoped') {
    return updates.filter(({ scope }) => scope === null)
  }
  if (context.mode === 'cell') {
    return updates.filter(({ scope }) =>
      scope !== null && scope.subjectId === context.cell.subjectId
    )
  }
  return [...updates]
}

export interface UpdatesModel {
  updates: UpdateSnapshot[]
  /**
   * Tokens for observations committed outside this model's editor. Local
   * keystrokes intentionally do not enter this map: changing an editor's
   * external revision while it owns the selection makes Lexical replace that
   * selection as if another window had edited the document.
   */
  externalObservationRevisions: ReadonlyMap<number, number>
  loading: boolean
  loadError: string | null
  revealUpdateId: number | null
  createUpdate: (
    input: Omit<CreateUpdateInput, 'parent'>
  ) => Promise<UpdateSnapshot>
  editUpdate: (id: number, input: EditUpdateInput) => Promise<UpdateSnapshot>
  saveObservation: (id: number, value: string) => void
  openObservation: (id: number) => void
  deleteUpdate: (id: number) => Promise<void>
}

/** Persistence-backed operations for direct Updates on one typed domain parent. */
export function useUpdatesModel(
  parent: UpdateParent,
  workingContext: UpdateWorkingContext = { mode: 'unfiltered' }
): UpdatesModel {
  const parentType = parent.type
  const parentId = parent.id
  const [updates, setUpdates] = useState<UpdateSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [revealUpdateId, setRevealUpdateId] = useState<number | null>(null)
  const [externalObservationRevisions, setExternalObservationRevisions] = useState<
    ReadonlyMap<number, number>
  >(() => new Map())
  const latestObservationRevisionsRef = useRef(new Map<number, number>())

  useEffect(() => {
    let active = true
    latestObservationRevisionsRef.current.clear()
    window.onmove.domain.listUpdates(updateParent(parentType, parentId)).then(
      (nextUpdates) => {
        if (!active) return
        setExternalObservationRevisions(new Map())
        setUpdates(sortUpdates(nextUpdates))
        setLoading(false)
      },
      () => {
        if (!active) return
        setExternalObservationRevisions(new Map())
        setLoadError('Updates could not be loaded.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [parentId, parentType])

  useEffect(() => window.onmove.richText.onDocumentChanged(({ document }) => {
    if (document.reference.type !== 'update' || document.reference.field !== 'observation') return
    const updateId = document.reference.id
    const latestRevision = latestObservationRevisionsRef.current.get(updateId) ?? -1
    // The synchronous local save is followed by an asynchronous broadcast to
    // this renderer. Ignore that delayed echo (and any older queued event), or
    // the active editor will interpret its own keystroke as an external edit.
    const observationChangedExternally = document.revision > latestRevision
    if (observationChangedExternally) {
      latestObservationRevisionsRef.current.set(updateId, document.revision)
      setExternalObservationRevisions((current) => {
        if (current.get(updateId) === document.revision) return current
        const next = new Map(current)
        next.set(updateId, document.revision)
        return next
      })
    }
    setUpdates((current) => sortUpdates(current.map((update) =>
      update.id === updateId
        ? {
            ...update,
            observation: observationChangedExternally ? document.value : update.observation,
            ...(document.updateMetadata ?? {}),
            updatedAt: document.updatedAt
          }
        : update
    )))
  }), [])

  useEffect(() => subscribeToUpdateCreated(({ update: created }) => {
    if (created.parent.type !== parentType || created.parent.id !== parentId) return
    setRevealUpdateId(created.id)
    setUpdates((current) => current.some(({ id }) => id === created.id)
      ? current
      : sortUpdates([...current, created]))
  }), [parentId, parentType])

  useEffect(() => window.onmove.onDomainChanged(() => {
    void window.onmove.domain.listUpdates(updateParent(parentType, parentId)).then((next) => {
      setUpdates(sortUpdates(next))
      setLoadError(null)
    }).catch(() => undefined)
  }), [parentId, parentType])

  async function createUpdate(
    input: Omit<CreateUpdateInput, 'parent'>
  ): Promise<UpdateSnapshot> {
    const { scope: requestedScope, ...draft } = input
    const scope = workingContext.mode === 'cell' ? workingContext.cell : requestedScope
    if (workingContext.mode === 'scope-overview' && !scope) {
      throw new Error('Select a Subject before adding a scoped Update')
    }
    const created = await window.onmove.domain.createUpdate({
      ...draft,
      parent: updateParent(parentType, parentId),
      ...(scope ? { scope } : {})
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

  function saveObservation(id: number, value: string): void {
    const document = window.onmove.richText.saveDocument(
      { type: 'update', id, field: 'observation' },
      value
    )
    latestObservationRevisionsRef.current.set(id, document.revision)
    setUpdates((current) => sortUpdates(current.map((update) => update.id === id
      ? { ...update, observation: document.value, updatedAt: document.updatedAt }
      : update
    )))
  }

  function openObservation(id: number): void {
    void window.onmove.richText.openWindow({ type: 'update', id, field: 'observation' })
  }

  return {
    updates: sortUpdates(updatesForWorkingContext(updates, workingContext)),
    externalObservationRevisions,
    loading,
    loadError,
    revealUpdateId,
    createUpdate,
    editUpdate,
    saveObservation,
    openObservation,
    deleteUpdate
  }
}
