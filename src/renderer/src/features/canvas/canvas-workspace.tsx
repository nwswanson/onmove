import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CaptureUpdateAction,
  Excalidraw,
  newElementWith,
  viewportCoordsToSceneCoords
} from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI
} from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { EntityLibrarySidebar } from '@/components/ui/entity-library-sidebar'
import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import {
  canvasCardModel,
  canvasEntityKey,
  canvasLibraryGroups
} from '@/features/canvas/canvas-presenters'
import { CanvasEntityWidget } from '@/features/canvas/canvas-entity-widget'
import {
  CANVAS_ENTITY_CARD_SIZE,
  canvasEntityCardLink,
  canvasEntityElementIds,
  createCanvasElementId,
  createEntityCardElements,
  encodeExcalidrawDocument,
  entityCardText,
  excalidrawInitialData,
  isCanvasEntityCardLink,
  reconcileEntityCards
} from '@/features/canvas/excalidraw-scene'
import { useCanvasModel } from '@/features/canvas/use-canvas-model'

const CONTEXTUAL_SIDEBAR_MIN = 232
const CONTEXTUAL_SIDEBAR_MAX = 360
const ENTITY_DRAG_MIME = 'application/x-onmove-canvas-entity'
const SAVE_DELAY_MS = 350

interface CanvasWorkspaceProps {
  contextDrawer: ContextDrawerControl
  hideSensitiveContent: boolean
}

interface PendingDocument {
  elements: readonly ExcalidrawElement[]
  appState: AppState
  files: BinaryFiles
}

/** One addressable OnMove Canvas backed by Excalidraw and SQLite, not browser storage. */
export function CanvasWorkspace({
  contextDrawer,
  hideSensitiveContent
}: CanvasWorkspaceProps): React.JSX.Element {
  const model = useCanvasModel()
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDocument = useRef<PendingDocument | null>(null)
  const saveDocument = useRef(model.saveDocument)
  const references = useMemo(
    () => model.canvas?.references ?? [],
    [model.canvas?.references]
  )
  const referencesRef = useRef(references)
  const referenceByElementId = useMemo(() => new Map(
    references.map((reference) => [reference.elementId, reference])
  ), [references])
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

  useEffect(() => {
    referencesRef.current = references
  }, [references])

  const flushPendingDocument = useCallback((): void => {
    const pending = pendingDocument.current
    pendingDocument.current = null
    if (!pending) return
    void saveDocument.current({
      data: encodeExcalidrawDocument(pending.elements, pending.appState, pending.files),
      entityElementIds: canvasEntityElementIds(pending.elements)
    }).catch((reason: unknown) => {
      setInteractionError(reason instanceof Error
        ? reason.message
        : 'The Canvas could not be saved.')
    })
  }, [])

  const schedulePersist = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles
  ): void => {
    pendingDocument.current = { elements, appState, files }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      flushPendingDocument()
    }, SAVE_DELAY_MS)
  }, [flushPendingDocument])

  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    flushPendingDocument()
  }, [flushPendingDocument])

  useEffect(() => {
    if (!excalidrawApi) return
    const current = excalidrawApi.getSceneElements()
    const reconciled = reconcileEntityCards(current, references)
    if (reconciled.changed) {
      excalidrawApi.updateScene({
        elements: reconciled.elements,
        captureUpdate: CaptureUpdateAction.NEVER
      })
    }
  }, [excalidrawApi, references])

  const handleChange = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles
  ): void => {
    const reconciled = reconcileEntityCards(elements, referencesRef.current)
    if (reconciled.changed && excalidrawApi) {
      excalidrawApi.updateScene({
        elements: reconciled.elements,
        captureUpdate: CaptureUpdateAction.NEVER
      })
    }
    schedulePersist(reconciled.elements, appState, files)
  }, [excalidrawApi, schedulePersist])

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLElement>) => {
    if (!excalidrawApi || !model.canvas) return
    const key = event.dataTransfer.getData(ENTITY_DRAG_MIME)
    const entity = entityByKey.get(key)
    if (!entity) return
    event.preventDefault()
    event.stopPropagation()
    setInteractionError(null)
    const point = viewportCoordsToSceneCoords(
      { clientX: event.clientX, clientY: event.clientY },
      excalidrawApi.getAppState()
    )
    const elementId = createCanvasElementId()
    const cardElements = createEntityCardElements(
      {
        ...entity,
        elementId,
        deleted: false,
        deletedAt: null
      },
      point.x - CANVAS_ENTITY_CARD_SIZE.width / 2,
      point.y - CANVAS_ENTITY_CARD_SIZE.height / 2
    )
    excalidrawApi.updateScene({
      elements: [...excalidrawApi.getSceneElements(), ...cardElements],
      appState: {
        selectedElementIds: { [elementId]: true }
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    try {
      await model.addEntityReference({
        elementId,
        target: entity.target
      })
    } catch (reason) {
      excalidrawApi.updateScene({
        elements: excalidrawApi.getSceneElements().map((element) => {
          const data = element.customData ?? {}
          return element.id === elementId || data.onmoveCardId === elementId
            ? newElementWith(element, { isDeleted: true })
            : element
        }),
        appState: { selectedElementIds: {} },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY
      })
      setInteractionError(reason instanceof Error
        ? reason.message
        : 'The item could not be placed on the Canvas.')
    }
  }, [entityByKey, excalidrawApi, model])

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
          <section className="sr-only" aria-label="Placed Canvas items">
            {references.map((reference) => (
              <article
                key={reference.elementId}
                data-canvas-entity-kind={reference.target.type}
                data-canvas-entity-id={reference.target.id}
                data-canvas-entity-deleted={reference.deleted ? 'true' : 'false'}
              >
                {entityCardText(reference)}
              </article>
            ))}
          </section>
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
              <Excalidraw
                key={model.canvas.id}
                name={model.canvas.name}
                initialData={excalidrawInitialData(model.canvas.data)}
                excalidrawAPI={setExcalidrawApi}
                onChange={handleChange}
                autoFocus
                detectScroll={false}
                handleKeyboardGlobally={false}
                validateEmbeddable={isCanvasEntityCardLink}
                renderEmbeddable={(element) => {
                  const reference = referenceByElementId.get(element.id)
                  if (!reference || element.link !== canvasEntityCardLink(reference)) return null
                  return (
                    <CanvasEntityWidget
                      model={canvasCardModel(reference)}
                      compact={element.width < 300 || element.height < 155}
                    />
                  )
                }}
                UIOptions={{
                  canvasActions: {
                    loadScene: false,
                    saveToActiveFile: false,
                    export: false,
                    saveAsImage: false,
                    toggleTheme: false
                  },
                  tools: { image: false }
                }}
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
