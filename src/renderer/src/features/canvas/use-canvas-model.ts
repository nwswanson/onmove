import { useCallback, useEffect, useState } from 'react'
import type {
  AddCanvasEntityReferenceInput,
  CanvasEntityReferenceSnapshot,
  CanvasEntitySnapshot,
  CanvasEntityTarget,
  CanvasSnapshot,
  OnMoveEntityLinkTarget,
  SaveCanvasDocumentInput
} from '../../../../shared/contracts'

async function loadCanvasData(): Promise<{
  canvas: CanvasSnapshot
  entities: CanvasEntitySnapshot[]
}> {
  const canvases = await window.onmove.canvas.list()
  const first = canvases[0]
  if (!first) throw new Error('The default Canvas is missing.')
  const [canvas, entities] = await Promise.all([
    window.onmove.canvas.get(first.id),
    window.onmove.canvas.listEntities()
  ])
  return { canvas, entities }
}

export interface CanvasModel {
  canvas: CanvasSnapshot | null
  entities: CanvasEntitySnapshot[]
  loading: boolean
  error: string | null
  addEntityReference: (
    input: AddCanvasEntityReferenceInput
  ) => Promise<CanvasEntityReferenceSnapshot>
  resolveEntity: (target: CanvasEntityTarget) => Promise<OnMoveEntityLinkTarget | null>
  saveDocument: (input: SaveCanvasDocumentInput) => Promise<void>
}

/** Owns all preload access for the Canvas feature; views receive plain state. */
export function useCanvasModel(): CanvasModel {
  const [canvas, setCanvas] = useState<CanvasSnapshot | null>(null)
  const [entities, setEntities] = useState<CanvasEntitySnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      void loadCanvasData().then(
      ({ canvas: nextCanvas, entities: nextEntities }) => {
        if (!active) return
        setCanvas(nextCanvas)
        setEntities(nextEntities)
        setLoading(false)
      },
      (reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'The Canvas could not be loaded.')
        setLoading(false)
      }
      )
    })
    const unsubscribe = window.onmove.canvas.onEntitiesChanged(() => {
      void loadCanvasData().then(({ canvas: nextCanvas, entities: nextEntities }) => {
        if (!active) return
        setCanvas((current) => current?.id === nextCanvas.id
          ? { ...nextCanvas, data: current.data, revision: current.revision }
          : nextCanvas)
        setEntities(nextEntities)
      }).catch(() => undefined)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const addEntityReference = useCallback(async (
    input: AddCanvasEntityReferenceInput
  ): Promise<CanvasEntityReferenceSnapshot> => {
    if (!canvas) throw new Error('The Canvas is not ready.')
    const reference = await window.onmove.canvas.addEntityReference(canvas.id, input)
    setCanvas((current) => current && current.id === canvas.id
      ? { ...current, references: [...current.references, reference] }
      : current)
    return reference
  }, [canvas])

  const resolveEntity = useCallback((target: CanvasEntityTarget) =>
    window.onmove.canvas.resolveEntity(target), [])

  const saveDocument = useCallback(async (input: SaveCanvasDocumentInput): Promise<void> => {
    if (!canvas) return
    const summary = await window.onmove.canvas.saveDocument(canvas.id, input)
    const retainedElementIds = new Set(input.entityElementIds)
    setCanvas((current) => current && current.id === summary.id
      ? {
          ...current,
          revision: summary.revision,
          updatedAt: summary.updatedAt,
          data: input.data,
          references: current.references.filter(({ elementId }) =>
            retainedElementIds.has(elementId))
        }
      : current)
  }, [canvas])

  return {
    canvas,
    entities,
    loading,
    error,
    addEntityReference,
    resolveEntity,
    saveDocument
  }
}
