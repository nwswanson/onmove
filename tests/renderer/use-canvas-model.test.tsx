// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  CanvasSnapshot,
  CanvasSummarySnapshot,
  OnMoveApi
} from '../../src/shared/contracts'
import { useCanvasModel } from '../../src/renderer/src/features/canvas/use-canvas-model'

const summary: CanvasSummarySnapshot = {
  id: 1,
  name: 'Default',
  revision: 0,
  createdAt: '2026-08-27T12:00:00.000Z',
  updatedAt: '2026-08-27T12:00:00.000Z'
}

const canvas: CanvasSnapshot = {
  ...summary,
  data: null,
  references: [
    {
      elementId: 'onmove_thread',
      target: { type: 'thread', id: 1 },
      title: 'Delivery',
      status: 'active',
      context: 'Atlas',
      details: {},
      effectiveSensitive: false,
      createdAt: '2026-08-27T12:00:00.000Z',
      deleted: false,
      deletedAt: null
    },
    {
      elementId: 'onmove_todo',
      target: { type: 'todo', id: 2 },
      title: 'Publish plan',
      status: 'open',
      context: 'Atlas › Delivery',
      details: {},
      effectiveSensitive: false,
      createdAt: '2026-08-27T12:00:01.000Z',
      deleted: false,
      deletedAt: null
    }
  ]
}

describe('useCanvasModel', () => {
  it('re-enables an entity after its Excalidraw card is removed and saved', async () => {
    const saveDocument = vi.fn().mockResolvedValue({
      ...summary,
      revision: 1,
      updatedAt: '2026-08-27T12:01:00.000Z'
    })
    const resolveEntity = vi.fn().mockResolvedValue({
      reference: { type: 'thread', id: 1 },
      focusId: 8,
      threadId: 1,
      commitmentId: null,
      routineId: null,
      subjectId: null
    })
    Object.defineProperty(window, 'onmove', {
      configurable: true,
      value: {
        canvas: {
          list: vi.fn().mockResolvedValue([summary]),
          get: vi.fn().mockResolvedValue(canvas),
          listEntities: vi.fn().mockResolvedValue([]),
          resolveEntity,
          addEntityReference: vi.fn(),
          saveDocument,
          onEntitiesChanged: vi.fn(() => () => undefined)
        }
      } as unknown as OnMoveApi
    })

    const { result } = renderHook(() => useCanvasModel())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => result.current.saveDocument({
      data: { type: 'excalidraw', elements: [] },
      entityElementIds: ['onmove_thread']
    }))

    expect(saveDocument).toHaveBeenCalledWith(1, expect.objectContaining({
      entityElementIds: ['onmove_thread']
    }))
    expect(result.current.canvas?.references.map(({ elementId }) => elementId))
      .toEqual(['onmove_thread'])

    await expect(result.current.resolveEntity({ type: 'thread', id: 1 })).resolves.toMatchObject({
      focusId: 8,
      threadId: 1
    })
    expect(resolveEntity).toHaveBeenCalledWith({ type: 'thread', id: 1 })
  })
})
