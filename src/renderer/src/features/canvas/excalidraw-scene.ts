import {
  convertToExcalidrawElements,
  newElementWith,
  serializeAsJSON
} from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import type {
  CanvasEntityReferenceSnapshot,
  CanvasEntitySnapshot,
  JsonObject
} from '../../../../shared/contracts'

export const CANVAS_ENTITY_CARD_SIZE = { width: 336, height: 196 } as const
const CARD_WIDTH = CANVAS_ENTITY_CARD_SIZE.width
const CARD_HEIGHT = CANVAS_ENTITY_CARD_SIZE.height

type EntityCardData = {
  onmoveRole: 'entity-card'
  onmoveEntityType: CanvasEntitySnapshot['target']['type']
  onmoveEntityId: number
  /** Present only on the legacy rectangle/text representation. */
  onmoveLabelId?: string
}

function customData(element: ExcalidrawElement): Record<string, unknown> {
  return element.customData ?? {}
}

function isEntityCard(element: ExcalidrawElement): boolean {
  return customData(element).onmoveRole === 'entity-card'
}

function isEntityLabelFor(element: ExcalidrawElement, elementId: string): boolean {
  return customData(element).onmoveRole === 'entity-label' &&
    customData(element).onmoveCardId === elementId
}

function formatKind(kind: CanvasEntitySnapshot['target']['type']): string {
  return kind.charAt(0).toLocaleUpperCase() + kind.slice(1)
}

function formatStatus(status: string | null): string {
  if (!status) return 'No status'
  return status
    .replaceAll('_', ' ')
    .replace(/\b\p{L}/gu, (character) => character.toLocaleUpperCase())
}

function compact(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

export function entityCardText(
  reference: CanvasEntityReferenceSnapshot | CanvasEntitySnapshot
): string {
  const kind = formatKind(reference.target.type)
  if ('deleted' in reference && reference.deleted) {
    const context = reference.context ? `\nWas in: ${compact(reference.context, 52)}` : ''
    return `Deleted ${kind}\n${compact(reference.title, 42)}${context}`
  }
  const context = reference.context ? `\n${compact(reference.context, 64)}` : ''
  return `${kind}\n${compact(reference.title, 42)}\n${formatStatus(reference.status)}${context}`
}

export function canvasEntityCardLink(
  reference: CanvasEntityReferenceSnapshot | CanvasEntitySnapshot
): string {
  return `onmove://${reference.target.type}/${reference.target.id}`
}

export function isCanvasEntityCardLink(link: string | null | undefined): boolean {
  return typeof link === 'string' &&
    /^onmove:\/\/(thread|commitment|note|routine|todo)\/[1-9]\d*$/.test(link)
}

export function createCanvasElementId(): string {
  const uuid = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
  if (uuid) return `onmove_${uuid}`
  return `onmove_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

export function createEntityCardElements(
  reference: CanvasEntityReferenceSnapshot,
  x: number,
  y: number
): ExcalidrawElement[] {
  const elementId = reference.elementId
  const cardData: EntityCardData = {
    onmoveRole: 'entity-card',
    onmoveEntityType: reference.target.type,
    onmoveEntityId: reference.target.id
  }
  const [base] = convertToExcalidrawElements([
    {
      id: elementId,
      type: 'rectangle',
      x,
      y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeColor: 'transparent',
      strokeStyle: 'solid',
      strokeWidth: 1,
      roughness: 0,
      customData: cardData
    }
  ], { regenerateIds: false })
  return [{
    ...base,
    type: 'embeddable',
    link: canvasEntityCardLink(reference),
    locked: reference.deleted
  } as ExcalidrawElement]
}

export function canvasEntityElementIds(
  elements: readonly ExcalidrawElement[]
): string[] {
  return elements
    .filter((element) => !element.isDeleted && isEntityCard(element))
    .map((element) => element.id)
}

function hasSameCardPresentation(
  element: ExcalidrawElement,
  reference: CanvasEntityReferenceSnapshot
): boolean {
  const data = customData(element)
  return element.type === 'embeddable' &&
    element.link === canvasEntityCardLink(reference) &&
    element.backgroundColor === 'transparent' &&
    element.strokeColor === 'transparent' &&
    element.strokeStyle === 'solid' &&
    element.strokeWidth === 1 &&
    element.roughness === 0 &&
    data.onmoveEntityType === reference.target.type &&
    data.onmoveEntityId === reference.target.id &&
    (!reference.deleted || element.locked)
}

/**
 * Reconciles only receiver-owned card presentation. Geometry and ordinary
 * Excalidraw elements remain editor-owned.
 */
export function reconcileEntityCards(
  elements: readonly ExcalidrawElement[],
  references: readonly CanvasEntityReferenceSnapshot[]
): { elements: ExcalidrawElement[]; changed: boolean } {
  const referenceById = new Map(references.map((reference) => [reference.elementId, reference]))
  const next = [...elements]
  let changed = false

  for (let index = 0; index < next.length; index += 1) {
    const element = next[index]
    const reference = referenceById.get(element.id)
    if (!reference || element.isDeleted || !isEntityCard(element)) continue
    if (!hasSameCardPresentation(element, reference)) {
      const updated = newElementWith(element, {
        link: canvasEntityCardLink(reference),
        backgroundColor: 'transparent',
        strokeColor: 'transparent',
        strokeStyle: 'solid',
        strokeWidth: 1,
        roughness: 0,
        locked: reference.deleted ? true : element.locked,
        customData: {
          onmoveRole: 'entity-card',
          onmoveEntityType: reference.target.type,
          onmoveEntityId: reference.target.id
        }
      })
      // `renderEmbeddable` is Excalidraw's supported React rendering boundary.
      // Converting the legacy rectangle in place retains id, index, position,
      // size, rotation, grouping, and every other editor-owned geometry field.
      next[index] = {
        ...updated,
        type: 'embeddable'
      } as ExcalidrawElement
      changed = true
    }

    const labelIndex = next.findIndex((candidate) =>
      !candidate.isDeleted && isEntityLabelFor(candidate, element.id))
    if (labelIndex >= 0) {
      next[labelIndex] = newElementWith(next[labelIndex], { isDeleted: true })
      changed = true
    }
  }

  // References and the Excalidraw document are committed together during
  // ordinary use, so a missing element indicates an interrupted write or a
  // migrated TLDraw document. Recover the authoritative reference as a card
  // instead of leaving the source item disabled and invisible. The stable grid
  // is deliberately presentation-only; subsequent geometry belongs to Excalidraw.
  const existingIds = new Set(next.map(({ id }) => id))
  const missing = references.filter(({ elementId }) => !existingIds.has(elementId))
  for (const [index, reference] of missing.entries()) {
    const column = index % 2
    const row = Math.floor(index / 2)
    next.push(...createEntityCardElements(
      reference,
      80 + column * (CARD_WIDTH + 40),
      80 + row * (CARD_HEIGHT + 40)
    ))
    changed = true
  }

  return { elements: next, changed }
}

export function encodeExcalidrawDocument(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles
): JsonObject {
  return JSON.parse(serializeAsJSON(elements, appState, files, 'database')) as JsonObject
}

export function excalidrawInitialData(data: JsonObject | null): ExcalidrawInitialDataState {
  if (data && Array.isArray(data.elements)) {
    return {
      ...data,
      elements: data.elements as unknown as ExcalidrawInitialDataState['elements'],
      appState: data.appState as ExcalidrawInitialDataState['appState'],
      files: data.files as ExcalidrawInitialDataState['files'],
      scrollToContent: true
    }
  }
  return {
    elements: [],
    appState: { viewBackgroundColor: '#f8f9fa' },
    files: {},
    scrollToContent: true
  }
}
