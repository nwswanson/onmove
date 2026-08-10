// @vitest-environment jsdom

import { act, render, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  OnMoveApi,
  RichTextDocumentChange,
  RichTextDocumentReference
} from '../../src/shared/contracts'
import { useDurableRichText } from '../../src/renderer/src/features/rich-text/use-durable-rich-text'
import { RichTextDocumentWindow } from '../../src/renderer/src/features/rich-text/rich-text-document-window'

describe('useDurableRichText', () => {
  it('exposes a draggable native title-bar region in detached document windows', () => {
    const reference = { type: 'note', id: 7, field: 'content' } as const
    const richText = {
      getDocument: vi.fn().mockResolvedValue({
        reference,
        title: 'Project — Default',
        value: '',
        revision: 0,
        updatedAt: '2026-08-09T12:00:00.000Z'
      }),
      saveDocument: vi.fn(),
      openWindow: vi.fn().mockResolvedValue(undefined),
      getWindowTarget: vi.fn().mockResolvedValue(reference),
      onDocumentChanged: vi.fn(() => () => undefined)
    } satisfies OnMoveApi['richText']
    Object.defineProperty(window, 'onmove', {
      value: { richText } as unknown as OnMoveApi,
      configurable: true
    })

    const { container } = render(<RichTextDocumentWindow reference={reference} />)
    expect(container.querySelector('[data-slot="rich-text-window-titlebar"]'))
      .toHaveClass('drag-region')
  })

  it('commits inline, opens a dedicated window, and applies revision broadcasts', async () => {
    const reference: RichTextDocumentReference = {
      type: 'note',
      id: 7,
      field: 'content'
    }
    let listener: ((change: RichTextDocumentChange) => void) | undefined
    let revision = 1
    const saveDocument = vi.fn((savedReference, value: string) => ({
      reference: savedReference,
      title: 'Project — Default',
      value,
      revision: ++revision,
      updatedAt: `2026-08-09T12:00:0${revision}.000Z`
    }))
    const openWindow = vi.fn().mockResolvedValue(undefined)
    const richText = {
      getDocument: vi.fn().mockResolvedValue({
        reference,
        title: 'Project — Default',
        value: 'Initial',
        revision,
        updatedAt: '2026-08-09T12:00:01.000Z'
      }),
      saveDocument,
      openWindow,
      getWindowTarget: vi.fn().mockResolvedValue(null),
      onDocumentChanged: vi.fn((nextListener) => {
        listener = nextListener
        return () => undefined
      })
    } satisfies OnMoveApi['richText']
    Object.defineProperty(window, 'onmove', {
      value: { richText } as unknown as OnMoveApi,
      configurable: true
    })

    const { result } = renderHook(() => useDurableRichText(reference))
    await waitFor(() => expect(result.current.value).toBe('Initial'))

    act(() => result.current.save('Typed once'))
    expect(saveDocument).toHaveBeenCalledWith(reference, 'Typed once')
    expect(result.current.value).toBe('Typed once')

    act(() => listener?.({
      document: {
        reference,
        title: 'Project — Default',
        value: 'Changed in another window',
        revision: 3,
        updatedAt: '2026-08-09T12:00:03.000Z'
      },
      sourceWindowId: 99
    }))
    expect(result.current.value).toBe('Changed in another window')

    act(() => result.current.openInWindow())
    expect(openWindow).toHaveBeenCalledWith(reference)
  })

  it('does not let a stale initial load overwrite a newer synchronous keystroke', async () => {
    const reference = { type: 'focus', id: 4, field: 'goal' } as const
    let resolveLoad: ((value: {
      reference: typeof reference
      title: string
      value: string
      revision: number
      updatedAt: string
    }) => void) | undefined
    const getDocument = vi.fn(() => new Promise<{
      reference: typeof reference
      title: string
      value: string
      revision: number
      updatedAt: string
    }>((resolve) => {
      resolveLoad = resolve
    }))
    const richText = {
      getDocument,
      saveDocument: vi.fn((_reference, value: string) => ({
        reference,
        title: 'Focus — Goal',
        value,
        revision: 2,
        updatedAt: '2026-08-09T12:00:02.000Z'
      })),
      openWindow: vi.fn().mockResolvedValue(undefined),
      getWindowTarget: vi.fn().mockResolvedValue(null),
      onDocumentChanged: vi.fn(() => () => undefined)
    } satisfies OnMoveApi['richText']
    Object.defineProperty(window, 'onmove', {
      value: { richText } as unknown as OnMoveApi,
      configurable: true
    })

    const { result } = renderHook(() => useDurableRichText(reference, 'Initial draft'))
    act(() => result.current.save('Local keystroke'))
    expect(result.current.value).toBe('Local keystroke')

    await act(async () => {
      resolveLoad?.({
        reference,
        title: 'Focus — Goal',
        value: 'Stale disk read',
        revision: 1,
        updatedAt: '2026-08-09T12:00:01.000Z'
      })
      await Promise.resolve()
    })
    expect(result.current.value).toBe('Local keystroke')
  })
})
