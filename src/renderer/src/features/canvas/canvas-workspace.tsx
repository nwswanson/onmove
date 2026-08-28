import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Tldraw,
  createShapeId,
  getSnapshot,
  loadSnapshot,
  type Editor,
  type TLComponents,
  type TLShapeId,
  type TLStoreSnapshot
} from 'tldraw'
import 'tldraw/tldraw.css'
import { EntityLibrarySidebar } from '@/components/ui/entity-library-sidebar'
import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import {
  CANVAS_ENTITY_SHAPE_TYPE,
  canvasEntityShapeUtils,
  type CanvasEntityShape
} from '@/features/canvas/canvas-entity-shape'
import {
  canvasEntityKey,
  canvasLibraryGroups
} from '@/features/canvas/canvas-presenters'
import { useCanvasModel } from '@/features/canvas/use-canvas-model'
import type {
  CanvasEntityReferenceSnapshot,
  CanvasEntitySnapshot,
  JsonObject
} from '../../../../shared/contracts'

const CONTEXTUAL_SIDEBAR_MIN = 232
const CONTEXTUAL_SIDEBAR_MAX = 360
const ENTITY_DRAG_MIME = 'application/x-onmove-canvas-entity'
const SAVE_DELAY_MS = 350
const canvasComponents: TLComponents = { PageMenu: null }

interface CanvasWorkspaceProps {
  contextDrawer: ContextDrawerControl
  hideSensitiveContent: boolean
}

function referenceProps(reference: CanvasEntityReferenceSnapshot): CanvasEntityShape['props'] {
  return {
    w: 260,
    h: 116,
    entityType: reference.target.type,
    entityId: reference.target.id,
    title: reference.title,
    status: reference.status ?? '',
    context: reference.context,
    deleted: reference.deleted,
    deletedAt: reference.deletedAt ?? ''
  }
}

function entityProps(entity: CanvasEntitySnapshot): CanvasEntityShape['props'] {
  return {
    w: 260,
    h: 116,
    entityType: entity.target.type,
    entityId: entity.target.id,
    title: entity.title,
    status: entity.status ?? '',
    context: entity.context,
    deleted: false,
    deletedAt: ''
  }
}

function canvasDocument(editor: Editor): {
  data: JsonObject
  entityShapeIds: string[]
} {
  const { document } = getSnapshot(editor.store)
  const entityShapeIds = editor.store.allRecords()
    .filter((record): record is CanvasEntityShape =>
      record.typeName === 'shape' && record.type === CANVAS_ENTITY_SHAPE_TYPE)
    .map(({ id }) => id)
  return {
    data: document as unknown as JsonObject,
    entityShapeIds
  }
}

/** One addressable OnMove Canvas backed by TLDraw and SQLite, not browser storage. */
export function CanvasWorkspace({
  contextDrawer,
  hideSensitiveContent
}: CanvasWorkspaceProps): React.JSX.Element {
  const model = useCanvasModel()
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveDocument = useRef(model.saveDocument)
  const canvasId = model.canvas?.id ?? null
  const references = useMemo(
    () => model.canvas?.references ?? [],
    [model.canvas?.references]
  )
  const initialData = model.canvas?.data
  const groups = useMemo(() => canvasLibraryGroups(
    model.entities,
    references,
    hideSensitiveContent
  ), [hideSensitiveContent, model.entities, references])
  const entityByKey = useMemo(() => new Map(
    model.entities.map((entity) => [canvasEntityKey(entity), entity])
  ), [model.entities])

  useEffect(() => {
    saveDocument.current = model.saveDocument
  }, [model.saveDocument])

  const persist = useCallback((currentEditor: Editor): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void saveDocument.current(canvasDocument(currentEditor)).catch((reason: unknown) => {
        setInteractionError(reason instanceof Error
          ? reason.message
          : 'The Canvas could not be saved.')
      })
    }, SAVE_DELAY_MS)
  }, [])

  const handleMount = (mountedEditor: Editor): (() => void) => {
    if (initialData) {
      loadSnapshot(mountedEditor.store, {
        document: initialData as unknown as TLStoreSnapshot
      })
    }
    setEditor(mountedEditor)
    const unsubscribe = mountedEditor.store.listen(
      () => persist(mountedEditor),
      { source: 'all', scope: 'document' }
    )
    return () => {
      unsubscribe()
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
        void saveDocument.current(canvasDocument(mountedEditor))
      }
      setEditor((current) => current === mountedEditor ? null : current)
    }
  }

  useEffect(() => {
    if (!editor) return
    for (const reference of references) {
      const shape = editor.getShape(reference.shapeId as TLShapeId)
      if (!shape || shape.type !== CANVAS_ENTITY_SHAPE_TYPE) continue
      const current = shape as CanvasEntityShape
      const next = referenceProps(reference)
      editor.updateShape<CanvasEntityShape>({
        id: current.id,
        type: CANVAS_ENTITY_SHAPE_TYPE,
        props: {
          ...next,
          w: current.props.w,
          h: current.props.h
        }
      })
    }
  }, [editor, references])

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLElement>) => {
    if (!editor || canvasId === null) return
    const key = event.dataTransfer.getData(ENTITY_DRAG_MIME)
    const entity = entityByKey.get(key)
    if (!entity) return
    event.preventDefault()
    event.stopPropagation()
    setInteractionError(null)
    const point = editor.screenToPage({ x: event.clientX, y: event.clientY })
    const shapeId = createShapeId()
    editor.markHistoryStoppingPoint('place OnMove item')
    editor.createShape<CanvasEntityShape>({
      id: shapeId,
      type: CANVAS_ENTITY_SHAPE_TYPE,
      x: point.x - 130,
      y: point.y - 58,
      props: entityProps(entity)
    })
    try {
      await model.addEntityReference({ shapeId, target: entity.target })
      editor.select(shapeId)
    } catch (reason) {
      editor.deleteShape(shapeId)
      setInteractionError(reason instanceof Error
        ? reason.message
        : 'The item could not be placed on the Canvas.')
    }
  }, [canvasId, editor, entityByKey, model])

  return (
    <WorkspaceShell
      contextualSidebar={
        <EntityLibrarySidebar
          title={model.canvas?.name ? `${model.canvas.name} Canvas` : 'Canvas'}
          groups={groups}
          width={sidebarWidth}
          onDragStart={(itemId, dataTransfer) => {
            dataTransfer.effectAllowed = 'copy'
            dataTransfer.setData(ENTITY_DRAG_MIME, itemId)
            dataTransfer.setData('text/plain', itemId)
          }}
        />
      }
      contextualSidebarResize={{
        label: 'Resize Canvas item library',
        value: sidebarWidth,
        min: CONTEXTUAL_SIDEBAR_MIN,
        max: CONTEXTUAL_SIDEBAR_MAX,
        direction: 1,
        onChange: setSidebarWidth
      }}
      main={
        <main
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
          aria-label="Canvas workspace"
          onDragOverCapture={(event) => {
            if (!event.dataTransfer.types.includes(ENTITY_DRAG_MIME)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDropCapture={(event) => void handleDrop(event)}
        >
          {model.loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading Canvas…
            </div>
          ) : model.error ? (
            <div className="flex h-full items-center justify-center p-8 text-sm text-destructive" role="alert">
              {model.error}
            </div>
          ) : model.canvas ? (
            <div className="absolute inset-0" data-canvas-id={model.canvas.id}>
              <Tldraw
                key={model.canvas.id}
                shapeUtils={canvasEntityShapeUtils}
                components={canvasComponents}
                onMount={handleMount}
              />
            </div>
          ) : null}
          {interactionError && (
            <div
              role="alert"
              className="absolute bottom-4 left-1/2 z-[400] max-w-sm -translate-x-1/2 rounded-lg border border-destructive/35 bg-background px-3 py-2 text-xs text-destructive shadow-lg"
            >
              {interactionError}
            </div>
          )}
        </main>
      }
      drawer={<ContextDrawerOutlet {...contextDrawer} />}
    />
  )
}
