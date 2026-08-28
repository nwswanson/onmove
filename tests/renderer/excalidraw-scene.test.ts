// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { CanvasEntityReferenceSnapshot } from '../../src/shared/contracts'
import {
  canvasEntityElementIds,
  createCanvasElementId,
  createEntityCardElements,
  encodeExcalidrawDocument,
  entityCardText,
  excalidrawInitialData,
  reconcileEntityCards
} from '../../src/renderer/src/features/canvas/excalidraw-scene'

function reference(
  overrides: Partial<CanvasEntityReferenceSnapshot> = {}
): CanvasEntityReferenceSnapshot {
  return {
    elementId: 'onmove_thread_card',
    target: { type: 'thread', id: 4 },
    title: 'Sprint execution',
    status: 'active',
    context: 'Project execution',
    effectiveSensitive: false,
    createdAt: '2026-08-27T12:00:00.000Z',
    deleted: false,
    deletedAt: null,
    ...overrides
  }
}

describe('Excalidraw Canvas scene adapter', () => {
  it('creates a grouped native card with durable receiver metadata', () => {
    const elements = createEntityCardElements(reference(), 120, 240)

    expect(elements).toHaveLength(2)
    expect(elements[0]).toMatchObject({
      id: 'onmove_thread_card',
      type: 'rectangle',
      x: 120,
      y: 240,
      width: 280,
      height: 112,
      customData: {
        onmoveRole: 'entity-card',
        onmoveEntityType: 'thread',
        onmoveEntityId: 4
      }
    })
    expect(elements[1]).toMatchObject({
      id: 'onmove_thread_card_label',
      type: 'text',
      text: 'Thread\nSprint execution\nActive',
      customData: {
        onmoveRole: 'entity-label',
        onmoveCardId: 'onmove_thread_card'
      }
    })
    expect(elements[0].groupIds).toEqual(elements[1].groupIds)
    expect(canvasEntityElementIds(elements)).toEqual(['onmove_thread_card'])
  })

  it('turns missing records into dashed cached ghosts without changing geometry', () => {
    const original = createEntityCardElements(reference(), 80, 160)
    const ghost = reference({
      title: 'Former sprint execution',
      context: 'Portfolio › Delivery',
      deleted: true,
      deletedAt: '2026-08-28T09:00:00.000Z'
    })

    const reconciled = reconcileEntityCards(original, [ghost])

    expect(reconciled.changed).toBe(true)
    expect(reconciled.elements[0]).toMatchObject({
      x: 80,
      y: 160,
      backgroundColor: 'transparent',
      strokeStyle: 'dashed'
    })
    expect(reconciled.elements[1]).toMatchObject({
      text: 'Deleted Thread\nFormer sprint execution\nWas in: Portfolio › Delivery'
    })
    expect(entityCardText(ghost)).toContain('Deleted Thread')
  })

  it('reconciles live status and title from the model while leaving ordinary drawings alone', () => {
    const original = createEntityCardElements(reference(), 0, 0)
    const ordinary = createEntityCardElements({
      ...reference(),
      elementId: 'ordinary_rectangle'
    }, 400, 0)[0]
    const ordinaryWithoutReceiverMetadata = { ...ordinary, customData: undefined }
    const changedReference = reference({ title: 'Release readiness', status: 'done' })

    const reconciled = reconcileEntityCards(
      [...original, ordinaryWithoutReceiverMetadata],
      [changedReference]
    )

    expect(reconciled.elements[1]).toMatchObject({
      text: 'Thread\nRelease readiness\nDone'
    })
    expect(reconciled.elements[2]).toBe(ordinaryWithoutReceiverMetadata)
  })

  it('serializes a database scene and restores only valid scene-shaped data', () => {
    const elements = createEntityCardElements(reference(), 10, 20)
    const document = encodeExcalidrawDocument(
      elements,
      { viewBackgroundColor: '#ffffff' } as AppState,
      {} as BinaryFiles
    )

    expect(document).toMatchObject({
      type: 'excalidraw',
      elements: expect.any(Array)
    })
    expect(excalidrawInitialData(document).elements).toHaveLength(2)
    expect(excalidrawInitialData({ unrelated: true }).elements).toEqual([])
    expect(createCanvasElementId()).toMatch(/^onmove_[A-Za-z0-9_]+$/)
  })
})
