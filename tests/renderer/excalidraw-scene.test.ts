// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { FONT_FAMILY, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { CanvasEntityReferenceSnapshot } from '../../src/shared/contracts'
import {
  canvasEntityElementIds,
  canvasEntityCardLink,
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
    details: {},
    effectiveSensitive: false,
    createdAt: '2026-08-27T12:00:00.000Z',
    deleted: false,
    deletedAt: null,
    ...overrides
  }
}

describe('Excalidraw Canvas scene adapter', () => {
  it('creates one native embeddable whose React receiver owns the widget interior', () => {
    const elements = createEntityCardElements(reference(), 120, 240)

    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatchObject({
      id: 'onmove_thread_card',
      type: 'embeddable',
      x: 120,
      y: 240,
      width: 336,
      height: 196,
      link: 'onmove://thread/4',
      customData: {
        onmoveRole: 'entity-card',
        onmoveEntityType: 'thread',
        onmoveEntityId: 4
      }
    })
    expect(canvasEntityCardLink(reference())).toBe(elements[0].link)
    expect(canvasEntityElementIds(elements)).toEqual(['onmove_thread_card'])
  })

  it('locks missing records for the dashed widget receiver without changing geometry', () => {
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
      type: 'embeddable',
      locked: true
    })
    expect(entityCardText(ghost)).toContain('Deleted Thread')
  })

  it('upgrades legacy rectangle/text cards in place while leaving ordinary drawings alone', () => {
    const legacy = convertToExcalidrawElements([
      {
        id: 'onmove_thread_card',
        type: 'rectangle',
        x: 12,
        y: 34,
        width: 280,
        height: 112,
        customData: {
          onmoveRole: 'entity-card',
          onmoveEntityType: 'thread',
          onmoveEntityId: 4,
          onmoveLabelId: 'onmove_thread_card_label'
        }
      },
      {
        id: 'onmove_thread_card_label',
        type: 'text',
        x: 30,
        y: 49,
        text: 'Thread\nSprint execution\nActive',
        fontFamily: FONT_FAMILY.Helvetica,
        customData: {
          onmoveRole: 'entity-label',
          onmoveCardId: 'onmove_thread_card'
        }
      },
      {
        id: 'ordinary_rectangle',
        type: 'rectangle',
        x: 400,
        y: 0,
        width: 120,
        height: 80
      }
    ], { regenerateIds: false })
    const changedReference = reference({ title: 'Release readiness', status: 'done' })

    const reconciled = reconcileEntityCards(legacy, [changedReference])

    expect(reconciled.changed).toBe(true)
    expect(reconciled.elements[0]).toMatchObject({
      type: 'embeddable',
      x: 12,
      y: 34,
      width: 280,
      height: 112,
      link: 'onmove://thread/4'
    })
    expect(reconciled.elements[1].isDeleted).toBe(true)
    expect(reconciled.elements[2]).toBe(legacy[2])
  })

  it('recovers a durable reference whose migrated scene has no matching element', () => {
    const repairedReference = reference({ elementId: 'legacy_canvas_1_1' })

    const reconciled = reconcileEntityCards([], [repairedReference])

    expect(reconciled.changed).toBe(true)
    expect(reconciled.elements).toHaveLength(1)
    expect(reconciled.elements[0]).toMatchObject({
      id: 'legacy_canvas_1_1',
      type: 'embeddable',
      x: 80,
      y: 80,
      width: 336,
      height: 196,
      link: 'onmove://thread/4'
    })
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
    expect(excalidrawInitialData(document).elements).toHaveLength(1)
    expect(excalidrawInitialData({ unrelated: true }).elements).toEqual([])
    expect(createCanvasElementId()).toMatch(/^onmove_[A-Za-z0-9_]+$/)
  })
})
