import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CaptureUpdateAction,
  Excalidraw,
  newElementWith,
  sceneCoordsToViewportCoords,
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
import type { FocusWorkspaceDestinationTarget } from '@/features/application/application-navigation'
import {
  canvasCardModel,
  canvasEntityKey,
  canvasLibraryGroups
} from '@/features/canvas/canvas-presenters'
import { CanvasEntityWidget } from '@/features/canvas/canvas-entity-widget'
import {
  CANVAS_ENTITY_CARD_SIZE,
  canvasEntityElementIds,
  createCanvasElementId,
  createEntityCardElements,
  encodeExcalidrawDocument,
  entityCardText,
  excalidrawInitialData,
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
  onOpenContext: (destination: FocusWorkspaceDestinationTarget) => void
}

interface PendingDocument {
  elements: readonly ExcalidrawElement[]
  appState: AppState
  files: BinaryFiles
}

interface CanvasSceneFrame {
  elements: readonly ExcalidrawElement[]
  appState: AppState
}

function sameSceneFrame(
  current: CanvasSceneFrame | null,
  elements: readonly ExcalidrawElement[],
  appState: AppState
): boolean {
  if (!current || current.elements.length !== elements.length) return false
  const sameElements = current.elements.every((element, index) => {
    const next = elements[index]
    return element === next || (
      element.id === next.id &&
      element.version === next.version &&
      element.versionNonce === next.versionNonce &&
      element.isDeleted === next.isDeleted
    )
  })
  return sameElements &&
    current.appState.scrollX === appState.scrollX &&
    current.appState.scrollY === appState.scrollY &&
    current.appState.zoom.value === appState.zoom.value &&
    current.appState.offsetLeft === appState.offsetLeft &&
    current.appState.offsetTop === appState.offsetTop &&
    current.appState.width === appState.width &&
    current.appState.height === appState.height
}

/** One addressable OnMove Canvas backed by Excalidraw and SQLite, not browser storage. */
export function CanvasWorkspace({
  contextDrawer,
  hideSensitiveContent,
  onOpenContext
}: CanvasWorkspaceProps): React.JSX.Element {
  const model = useCanvasModel()
  const resolveCanvasEntity = model.resolveEntity
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [sceneFrame, setSceneFrame] = useState<CanvasSceneFrame | null>(null)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDocument = useRef<PendingDocument | null>(null)
  const saveDocument = useRef(model.saveDocument)
  const dragCleanup = useRef<(() => void) | null>(null)
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

  const updateSceneFrame = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: AppState
  ): void => {
    setSceneFrame((current) => sameSceneFrame(current, elements, appState)
      ? current
      : { elements, appState })
  }, [])

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
    dragCleanup.current?.()
    dragCleanup.current = null
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    flushPendingDocument()
  }, [flushPendingDocument])

  useEffect(() => {
    if (!excalidrawApi) return
    let active = true
    const current = excalidrawApi.getSceneElements()
    const reconciled = reconcileEntityCards(current, references)
    queueMicrotask(() => {
      if (!active) return
      updateSceneFrame(
        reconciled.changed ? reconciled.elements : current,
        excalidrawApi.getAppState()
      )
    })
    if (reconciled.changed) {
      excalidrawApi.updateScene({
        elements: reconciled.elements,
        captureUpdate: CaptureUpdateAction.NEVER
      })
    }
    return () => { active = false }
  }, [excalidrawApi, references, updateSceneFrame])

  const handleChange = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles
  ): void => {
    const reconciled = reconcileEntityCards(elements, referencesRef.current)
    updateSceneFrame(reconciled.changed ? reconciled.elements : elements, appState)
    if (reconciled.changed && excalidrawApi) {
      excalidrawApi.updateScene({
        elements: reconciled.elements,
        captureUpdate: CaptureUpdateAction.NEVER
      })
    }
    schedulePersist(reconciled.elements, appState, files)
  }, [excalidrawApi, schedulePersist, updateSceneFrame])

  const moveCard = useCallback((
    elementId: string,
    pointer: React.PointerEvent<HTMLElement>
  ): void => {
    if (!excalidrawApi) return
    const source = excalidrawApi.getSceneElements().find(({ id }) => id === elementId)
    if (!source || source.isDeleted) return
    const start = {
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      x: source.x,
      y: source.y,
      zoom: excalidrawApi.getAppState().zoom.value
    }
    let lastClientX = pointer.clientX
    let lastClientY = pointer.clientY

    const updatePosition = (
      clientX: number,
      clientY: number,
      captureUpdate: typeof CaptureUpdateAction.NEVER | typeof CaptureUpdateAction.IMMEDIATELY
    ): void => {
      lastClientX = clientX
      lastClientY = clientY
      const next = excalidrawApi.getSceneElements().map((element) =>
        element.id === elementId
          ? newElementWith(element, {
              x: start.x + (clientX - start.clientX) / start.zoom,
              y: start.y + (clientY - start.clientY) / start.zoom
            })
          : element)
      excalidrawApi.updateScene({ elements: next, captureUpdate })
      updateSceneFrame(next, excalidrawApi.getAppState())
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      if (dragCleanup.current === cleanup) dragCleanup.current = null
    }
    const handlePointerMove = (event: PointerEvent): void => {
      event.preventDefault()
      updatePosition(event.clientX, event.clientY, CaptureUpdateAction.NEVER)
    }
    const handlePointerUp = (event: PointerEvent): void => {
      const cancelled = event.type === 'pointercancel'
      updatePosition(cancelled ? lastClientX : event.clientX, cancelled ? lastClientY : event.clientY,
        CaptureUpdateAction.IMMEDIATELY)
      cleanup()
    }

    dragCleanup.current?.()
    dragCleanup.current = cleanup
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [excalidrawApi, updateSceneFrame])

  const removeCard = useCallback((elementId: string): void => {
    if (!excalidrawApi) return
    const next = excalidrawApi.getSceneElements().map((element) =>
      element.id === elementId
        ? newElementWith(element, { isDeleted: true })
        : element)
    excalidrawApi.updateScene({
      elements: next,
      appState: { selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    updateSceneFrame(next, excalidrawApi.getAppState())
  }, [excalidrawApi, updateSceneFrame])

  const openEntity = useCallback(async (
    target: Parameters<typeof resolveCanvasEntity>[0]
  ): Promise<void> => {
    setInteractionError(null)
    try {
      const destination = await resolveCanvasEntity(target)
      if (!destination) throw new Error('That item is no longer available.')
      onOpenContext({
        focusId: destination.focusId,
        threadId: destination.threadId,
        commitmentId: destination.commitmentId,
        routineId: destination.routineId,
        subjectId: destination.subjectId
      })
    } catch (reason) {
      setInteractionError(reason instanceof Error
        ? reason.message
        : 'The item could not be opened.')
    }
  }, [onOpenContext, resolveCanvasEntity])

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
        selectedElementIds: {}
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
              {sceneFrame && (
                <div className="pointer-events-none absolute inset-0 z-[2]" aria-label="Canvas widgets">
                  {sceneFrame.elements.map((element) => {
                    if (element.isDeleted) return null
                    const reference = referenceByElementId.get(element.id)
                    if (!reference) return null
                    const viewport = sceneCoordsToViewportCoords({
                      sceneX: element.x,
                      sceneY: element.y
                    }, sceneFrame.appState)
                    return (
                      <div
                        key={element.id}
                        className="pointer-events-none absolute left-0 top-0 origin-top-left"
                        style={{
                          transform: `translate(${viewport.x - sceneFrame.appState.offsetLeft}px, ${viewport.y - sceneFrame.appState.offsetTop}px) scale(${sceneFrame.appState.zoom.value})`
                        }}
                      >
                        <div
                          className="pointer-events-none"
                          style={{
                            width: element.width,
                            height: element.height,
                            transform: `rotate(${element.angle}rad)`
                          }}
                        >
                          <CanvasEntityWidget
                            model={canvasCardModel(reference)}
                            compact={element.width < 300 || element.height < 155}
                            onOpen={reference.deleted
                              ? undefined
                              : () => void openEntity(reference.target)}
                            onRemove={() => removeCard(element.id)}
                            onMovePointerDown={reference.deleted
                              ? undefined
                              : (event) => moveCard(element.id, event)}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
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
