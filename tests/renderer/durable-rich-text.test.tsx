// @vitest-environment jsdom

import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  OnMoveApi,
  RichTextDocumentChange,
  RichTextDocumentReference,
  RichTextDocumentSnapshot
} from '../../src/shared/contracts'
import { useDurableRichText } from '../../src/renderer/src/features/rich-text/use-durable-rich-text'
import { RichTextDocumentWindow } from '../../src/renderer/src/features/rich-text/rich-text-document-window'

describe('useDurableRichText', () => {
  it('exposes hierarchy context, a draggable title bar, and a full-height editor chain', async () => {
    const reference = { type: 'note', id: 7, field: 'content' } as const
    const richText = {
      getDocument: vi.fn().mockResolvedValue({
        reference,
        title: 'Sprint execution — Default Note',
        kind: 'note',
        context: [
          { kind: 'focus', title: 'Project Atlas' },
          { kind: 'thread', title: 'Sprint execution' }
        ],
        subject: null,
        updateMetadata: null,
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
    await waitFor(() => expect(container.querySelector('nav[aria-label="Document context"]'))
      .toHaveTextContent('Project AtlasSprint execution'))
    expect(screen.getByText('Default Note')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByText('Portfolio')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Focus type' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Thread type' })).toBeInTheDocument()
    expect(container).not.toHaveTextContent('OnMove document')
    expect(container).not.toHaveTextContent('Saved locally as you type')
    expect(container.querySelector('[data-slot="rich-text-window-titlebar"]'))
      .toHaveClass('drag-region')
    expect(container.querySelector('[data-slot="rich-text-window-editor-region"]'))
      .toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col')
    expect(container.querySelector('[data-slot="rich-text-editor"]'))
      .toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col')
    expect(container.querySelector('[data-slot="rich-text-editor-document"]'))
      .toHaveClass('min-h-0', 'flex-1', 'overflow-hidden')
    expect(container.querySelector('[contenteditable="true"]'))
      .toHaveClass('h-full', 'min-h-0', 'resize-none', 'overflow-auto')
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
      title: 'Project — Default Note',
      kind: 'note' as const,
      context: [{ kind: 'focus' as const, title: 'Project Atlas' }],
      subject: null,
      updateMetadata: null,
      value,
      revision: ++revision,
      updatedAt: `2026-08-09T12:00:0${revision}.000Z`
    }))
    const openWindow = vi.fn().mockResolvedValue(undefined)
    const richText = {
      getDocument: vi.fn().mockResolvedValue({
        reference,
        title: 'Project — Default Note',
        kind: 'note',
        context: [{ kind: 'focus', title: 'Project Atlas' }],
        subject: null,
        updateMetadata: null,
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
        title: 'Project — Default Note',
        kind: 'note',
        context: [{ kind: 'focus', title: 'Project Atlas' }],
        subject: null,
        updateMetadata: null,
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
    const reference = { type: 'focus', id: 4, field: 'description' } as const
    let resolveLoad: ((value: {
      reference: typeof reference
      title: string
      kind: 'description'
      context: Array<{ kind: 'focus'; title: string }>
      subject: null
      updateMetadata: null
      value: string
      revision: number
      updatedAt: string
    }) => void) | undefined
    const getDocument = vi.fn(() => new Promise<{
      reference: typeof reference
      title: string
      kind: 'description'
      context: Array<{ kind: 'focus'; title: string }>
      subject: null
      updateMetadata: null
      value: string
      revision: number
      updatedAt: string
    }>((resolve) => {
      resolveLoad = resolve
    }))
    const richText = {
      getDocument,
      saveDocument: vi.fn((_reference, value: string): RichTextDocumentSnapshot => ({
        reference,
        title: 'Focus — Goal',
        kind: 'description',
        context: [{ kind: 'focus', title: 'Focus' }],
        subject: null,
        updateMetadata: null,
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
        kind: 'description',
        context: [{ kind: 'focus', title: 'Focus' }],
        subject: null,
        updateMetadata: null,
        value: 'Stale disk read',
        revision: 1,
        updatedAt: '2026-08-09T12:00:01.000Z'
      })
      await Promise.resolve()
    })
    expect(result.current.value).toBe('Local keystroke')
  })

  it('renders scoped Update metadata without an h1 or delete control and saves changes', async () => {
    const reference = { type: 'update', id: 17, field: 'observation' } as const
    const documentSnapshot: RichTextDocumentSnapshot = {
      reference,
      title: 'Delivery — Update',
      kind: 'update',
      context: [
        { kind: 'focus', title: 'Project Atlas' },
        { kind: 'thread', title: 'Delivery' },
        { kind: 'commitment', title: 'Publish release notes' }
      ],
      subject: { id: 9, name: 'Platform Team' },
      updateMetadata: { date: '2026-08-19', state: 'yellow', sensitive: false },
      value: 'Status changed',
      revision: 2,
      updatedAt: '2026-08-19T12:00:00.000Z'
    }
    const updateUpdate = vi.fn((_id: number, input: { state?: string; sensitive?: boolean }) =>
      Promise.resolve({
        id: 17,
        parent: { type: 'commitment', id: 4 },
        date: '2026-08-19',
        observation: 'Status changed',
        state: input.state ?? 'yellow',
        sensitive: input.sensitive ?? false,
        scope: { scopeId: 8, subjectId: 9 },
        createdAt: '2026-08-19T12:00:00.000Z',
        updatedAt: '2026-08-19T12:01:00.000Z'
      }))
    const richText = {
      getDocument: vi.fn().mockResolvedValue(documentSnapshot),
      saveDocument: vi.fn((_savedReference, value: string) => ({
        ...documentSnapshot,
        value,
        revision: documentSnapshot.revision + 1
      })),
      openWindow: vi.fn().mockResolvedValue(undefined),
      getWindowTarget: vi.fn().mockResolvedValue(reference),
      onDocumentChanged: vi.fn(() => () => undefined)
    } satisfies OnMoveApi['richText']
    Object.defineProperty(window, 'onmove', {
      value: { domain: { updateUpdate }, richText } as unknown as OnMoveApi,
      configurable: true
    })

    const user = userEvent.setup()
    render(<RichTextDocumentWindow reference={reference} />)
    await screen.findByText('Platform Team')

    expect(screen.getByRole('img', { name: 'Focus type' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Thread type' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Commitment type' })).toBeInTheDocument()
    expect(screen.queryByText('Update', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete update' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Update state'), 'green')
    await waitFor(() => expect(updateUpdate).toHaveBeenCalledWith(17, { state: 'green' }))
    await user.click(screen.getByRole('checkbox', { name: 'Sensitive' }))
    await waitFor(() => expect(updateUpdate).toHaveBeenCalledWith(17, { sensitive: true }))
  })
})
