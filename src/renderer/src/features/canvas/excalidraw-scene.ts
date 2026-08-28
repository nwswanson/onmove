import {
  FONT_FAMILY,
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

const CARD_WIDTH = 280
const CARD_HEIGHT = 112
const CARD_BACKGROUND = '#ffffff'
const CARD_STROKE = '#868e96'
const CARD_TEXT = '#343a40'
const GHOST_TEXT = '#868e96'

type EntityCardData = {
  onmoveRole: 'entity-card'
  onmoveEntityType: CanvasEntitySnapshot['target']['type']
  onmoveEntityId: number
  onmoveLabelId: string
}

type EntityLabelData = {
  onmoveRole: 'entity-label'
  onmoveCardId: string
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
  return `${kind}\n${compact(reference.title, 42)}\n${formatStatus(reference.status)}`
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
  const labelId = `${elementId}_label`
  const groupId = `${elementId}_group`
  const cardData: EntityCardData = {
    onmoveRole: 'entity-card',
    onmoveEntityType: reference.target.type,
    onmoveEntityId: reference.target.id,
    onmoveLabelId: labelId
  }
  const labelData: EntityLabelData = {
    onmoveRole: 'entity-label',
    onmoveCardId: elementId
  }

  return convertToExcalidrawElements([
    {
      id: elementId,
      type: 'rectangle',
      x,
      y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      groupIds: [groupId],
      backgroundColor: reference.deleted ? 'transparent' : CARD_BACKGROUND,
      fillStyle: 'solid',
      strokeColor: CARD_STROKE,
      strokeStyle: reference.deleted ? 'dashed' : 'solid',
      strokeWidth: 2,
      roughness: 0,
      customData: cardData
    },
    {
      id: labelId,
      type: 'text',
      x: x + 18,
      y: y + 15,
      width: CARD_WIDTH - 36,
      height: CARD_HEIGHT - 30,
      groupIds: [groupId],
      text: entityCardText(reference),
      fontFamily: FONT_FAMILY.Helvetica,
      fontSize: 16,
      textAlign: 'left',
      verticalAlign: 'middle',
      strokeColor: reference.deleted ? GHOST_TEXT : CARD_TEXT,
      roughness: 0,
      customData: labelData
    }
  ], { regenerateIds: false })
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
  return element.type === 'rectangle' &&
    element.width === CARD_WIDTH &&
    element.height === CARD_HEIGHT &&
    element.backgroundColor === (reference.deleted ? 'transparent' : CARD_BACKGROUND) &&
    element.strokeColor === CARD_STROKE &&
    element.strokeStyle === (reference.deleted ? 'dashed' : 'solid') &&
    element.strokeWidth === 2 &&
    element.roughness === 0
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
      next[index] = newElementWith(element, {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        backgroundColor: reference.deleted ? 'transparent' : CARD_BACKGROUND,
        strokeColor: CARD_STROKE,
        strokeStyle: reference.deleted ? 'dashed' : 'solid',
        strokeWidth: 2,
        roughness: 0
      })
      changed = true
    }

    const labelIndex = next.findIndex((candidate) =>
      !candidate.isDeleted && isEntityLabelFor(candidate, element.id))
    const expectedText = entityCardText(reference)
    if (labelIndex >= 0) {
      const label = next[labelIndex]
      if (label.type === 'text' && (
        label.text !== expectedText ||
        label.strokeColor !== (reference.deleted ? GHOST_TEXT : CARD_TEXT) ||
        label.fontFamily !== FONT_FAMILY.Helvetica ||
        label.fontSize !== 16
      )) {
        next[labelIndex] = newElementWith(label, {
          text: expectedText,
          originalText: expectedText,
          strokeColor: reference.deleted ? GHOST_TEXT : CARD_TEXT,
          fontFamily: FONT_FAMILY.Helvetica,
          fontSize: 16,
          roughness: 0
        })
        changed = true
      }
    }
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
