// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  DomainChangeSnapshot,
  OnMoveApi,
  UpdateSnapshot
} from '../../src/shared/contracts'
import { useUpdatesModel } from '../../src/renderer/src/features/updates/use-updates-model'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((next) => {
      resolve = next
    }),
    resolve
  }
}

describe('useUpdatesModel external reconciliation', () => {
  it('shows an MCP-created Update immediately and ignores an older list response', async () => {
    const initial = deferred<UpdateSnapshot[]>()
    const reconciliation = deferred<UpdateSnapshot[]>()
    const listUpdates = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(reconciliation.promise)
    let onDomainChanged: ((change: DomainChangeSnapshot) => void) | undefined
    const created: UpdateSnapshot = {
      id: 42,
      parent: { type: 'thread', id: 7 },
      date: '2026-09-04',
      observation: 'onmove-rich-text:1:{"root":{"children":[]}}',
      state: 'green',
      sensitive: false,
      scope: null,
      createdAt: '2026-09-04T15:00:00.000Z',
      updatedAt: '2026-09-04T15:00:00.000Z'
    }

    Object.defineProperty(window, 'onmove', {
      configurable: true,
      value: {
        domain: { listUpdates },
        richText: { onDocumentChanged: vi.fn(() => () => undefined) },
        onDomainChanged: vi.fn((listener) => {
          onDomainChanged = listener
          return () => undefined
        })
      } as unknown as OnMoveApi
    })

    const { result } = renderHook(() => useUpdatesModel({ type: 'thread', id: 7 }))
    await waitFor(() => expect(listUpdates).toHaveBeenCalledOnce())

    act(() => onDomainChanged?.({
      source: 'mcp',
      kind: 'update-created',
      update: created
    }))
    expect(result.current.updates).toEqual([created])
    expect(result.current.loading).toBe(false)
    expect(result.current.revealUpdateId).toBe(created.id)
    expect(listUpdates).toHaveBeenCalledTimes(2)

    await act(async () => initial.resolve([]))
    expect(result.current.updates).toEqual([created])

    await act(async () => reconciliation.resolve([created]))
    expect(result.current.updates).toEqual([created])
  })
})
