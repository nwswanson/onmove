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
  it('hydrates a newly created non-empty Update whose durable revision is zero', async () => {
    const reference = { type: 'update', id: 17, field: 'observation' } as const
    const richText = {
      getDocument: vi.fn().mockResolvedValue({
        reference,
        title: 'Sprint execution — Update',
        kind: 'update',
        context: [
          { kind: 'focus', title: 'Project Atlas' },
          { kind: 'thread', title: 'Sprint execution' }
        ],
        subject: null,
        updateMetadata: { date: '2026-09-03', state: 'green', sensitive: false },
        value: 'Created through Cmd-P',
        revision: 0,
        updatedAt: '2026-09-03T12:00:00.000Z'
      }),
      listHistory: vi.fn().mockResolvedValue([]),
      restoreHistory: vi.fn(async (target) => ({ reference: target, value: '', history: [] })),
      saveDocument: vi.fn(),
      openWindow: vi.fn().mockResolvedValue(undefined),
      getWindowTarget: vi.fn().mockResolvedValue(reference),
      onDocumentChanged: vi.fn(() => () => undefined)
    } satisfies OnMoveApi['richText']
    Object.defineProperty(window, 'onmove', {
      value: { richText } as unknown as OnMoveApi,
      configurable: true
    })

    render(<RichTextDocumentWindow reference={reference} />)

    expect(await screen.findByRole('textbox', { name: 'Document content' }))
      .toHaveTextContent('Created through Cmd-P')
    expect(screen.getByText('Sprint execution', { exact: true })).toBeInTheDocument()
  })

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
      listHistory: vi.fn().mockResolvedValue([]),
      restoreHistory: vi.fn(async (target) => ({ reference: target, value: '', history: [] })),
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
      listHistory: vi.fn().mockResolvedValue([]),
      restoreHistory: vi.fn(async (target) => ({ reference: target, value: '', history: [] })),
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
    const hydratedExternalRevision = result.current.externalRevision

    act(() => result.current.save('Typed once'))
    expect(saveDocument).toHaveBeenCalledWith(reference, 'Typed once')
    expect(result.current.value).toBe('Typed once')
    expect(result.current.externalRevision).toBe(hydratedExternalRevision)

    act(() => listener?.({
      document: saveDocument.mock.results[0].value as RichTextDocumentSnapshot,
      sourceWindowId: 7
    }))
    expect(result.current.externalRevision).toBe(hydratedExternalRevision)

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
    expect(result.current.externalRevision).toBeGreaterThan(hydratedExternalRevision)

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
      listHistory: vi.fn().mockResolvedValue([]),
      restoreHistory: vi.fn(async (target) => ({ reference: target, value: '', history: [] })),
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

  it('does not let a pending initial read overwrite an equally versioned broadcast', async () => {
    const reference = { type: 'update', id: 17, field: 'observation' } as const
    const initial: RichTextDocumentSnapshot = {
      reference,
      title: 'Delivery — Update',
      kind: 'update',
      context: [{ kind: 'thread', title: 'Delivery' }],
      subject: null,
      updateMetadata: { date: '2026-08-19', state: 'yellow', sensitive: false },
      value: 'Status changed',
      revision: 2,
      updatedAt: '2026-08-19T12:00:00.000Z'
    }
    let resolveLoad: ((value: RichTextDocumentSnapshot) => void) | undefined
    let listener: ((change: RichTextDocumentChange) => void) | undefined
    const richText = {
      getDocument: vi.fn(() => new Promise<RichTextDocumentSnapshot>((resolve) => {
        resolveLoad = resolve
      })),
      listHistory: vi.fn().mockResolvedValue([]),
      restoreHistory: vi.fn(async (target) => ({ reference: target, value: '', history: [] })),
      saveDocument: vi.fn(),
      openWindow: vi.fn().mockResolvedValue(undefined),
      getWindowTarget: vi.fn().mockResolvedValue(reference),
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
    act(() => listener?.({
      document: {
        ...initial,
        updateMetadata: { ...initial.updateMetadata!, state: 'green' }
      },
      sourceWindowId: 99
    }))
    expect(result.current.updateMetadata?.state).toBe('green')

    await act(async () => {
      resolveLoad?.(initial)
      await Promise.resolve()
    })

    expect(result.current.updateMetadata?.state).toBe('green')
    expect(result.current.value).toBe('Status changed')
  })

  it('does not let failed metadata recovery overwrite a newer synchronous text save', async () => {
    const reference = { type: 'update', id: 17, field: 'observation' } as const
    const initial: RichTextDocumentSnapshot = {
      reference,
      title: 'Delivery — Update',
      kind: 'update',
      context: [{ kind: 'thread', title: 'Delivery' }],
      subject: null,
      updateMetadata: { date: '2026-08-19', state: 'yellow', sensitive: false },
      value: 'Old text',
      revision: 2,
      updatedAt: '2026-08-19T12:00:00.000Z'
    }
    let resolveRecovery: ((value: RichTextDocumentSnapshot) => void) | undefined
    const getDocument = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => new Promise<RichTextDocumentSnapshot>((resolve) => {
        resolveRecovery = resolve
      }))
    const saved: RichTextDocumentSnapshot = {
      ...initial,
      value: 'New local text',
      revision: 3,
      updatedAt: '2026-08-19T12:02:00.000Z'
    }
    const richText = {
      getDocument,
      listHistory: vi.fn().mockResolvedValue([]),
      restoreHistory: vi.fn(async (target) => ({ reference: target, value: '', history: [] })),
      saveDocument: vi.fn(() => saved),
      openWindow: vi.fn().mockResolvedValue(undefined),
      getWindowTarget: vi.fn().mockResolvedValue(reference),
      onDocumentChanged: vi.fn(() => () => undefined)
    } satisfies OnMoveApi['richText']
    Object.defineProperty(window, 'onmove', {
      value: {
        domain: { updateUpdate: vi.fn().mockRejectedValue(new Error('save failed')) },
        richText
      } as unknown as OnMoveApi,
      configurable: true
    })

    const { result } = renderHook(() => useDurableRichText(reference))
    await waitFor(() => expect(result.current.value).toBe('Old text'))
    await act(async () => result.current.saveUpdateMetadata({ state: 'green' }))
    expect(getDocument).toHaveBeenCalledTimes(2)

    act(() => result.current.save('New local text'))
    await act(async () => {
      resolveRecovery?.(initial)
      await Promise.resolve()
    })

    expect(result.current.value).toBe('New local text')
    expect(result.current.revision).toBe(3)
  })

  it('does not let an older metadata response overwrite a newer broadcast', async () => {
    const reference = { type: 'update', id: 17, field: 'observation' } as const
    const initial: RichTextDocumentSnapshot = {
      reference,
      title: 'Delivery — Update',
      kind: 'update',
      context: [{ kind: 'thread', title: 'Delivery' }],
      subject: null,
      updateMetadata: { date: '2026-08-19', state: 'yellow', sensitive: false },
      value: 'Status changed',
      revision: 2,
      updatedAt: '2026-08-19T12:00:00.000Z'
    }
    let listener: ((change: RichTextDocumentChange) => void) | undefined
    let resolveMetadata: ((value: Awaited<ReturnType<OnMoveApi['domain']['updateUpdate']>>) => void)
      | undefined
    const updateUpdate = vi.fn(() => new Promise<
      Awaited<ReturnType<OnMoveApi['domain']['updateUpdate']>>
    >((resolve) => {
      resolveMetadata = resolve
    }))
    const richText = {
      getDocument: vi.fn().mockResolvedValue(initial),
      listHistory: vi.fn().mockResolvedValue([]),
      restoreHistory: vi.fn(async (target) => ({ reference: target, value: '', history: [] })),
      saveDocument: vi.fn(),
      openWindow: vi.fn().mockResolvedValue(undefined),
      getWindowTarget: vi.fn().mockResolvedValue(reference),
      onDocumentChanged: vi.fn((nextListener) => {
        listener = nextListener
        return () => undefined
      })
    } satisfies OnMoveApi['richText']
    Object.defineProperty(window, 'onmove', {
      value: { domain: { updateUpdate }, richText } as unknown as OnMoveApi,
      configurable: true
    })

    const { result } = renderHook(() => useDurableRichText(reference))
    await waitFor(() => expect(result.current.updateMetadata?.state).toBe('yellow'))
    let metadataSave: Promise<void> | undefined
    act(() => {
      metadataSave = result.current.saveUpdateMetadata({ state: 'green' })
    })
    expect(result.current.updateMetadata?.state).toBe('green')

    act(() => listener?.({
      document: {
        ...initial,
        updateMetadata: { ...initial.updateMetadata!, state: 'red' },
        updatedAt: '2026-08-19T12:02:00.000Z'
      },
      sourceWindowId: 99
    }))
    await act(async () => {
      resolveMetadata?.({
        id: 17,
        parent: { type: 'thread', id: 4 },
        date: '2026-08-19',
        observation: 'Status changed',
        state: 'green',
        sensitive: false,
        scope: null,
        createdAt: '2026-08-19T11:00:00.000Z',
        updatedAt: '2026-08-19T12:01:00.000Z'
      })
      await metadataSave
    })

    expect(result.current.updateMetadata?.state).toBe('red')
  })

  it('reconciles equal-revision Update metadata without resynchronizing editor text', async () => {
    const reference = { type: 'update', id: 17, field: 'observation' } as const
    const initial: RichTextDocumentSnapshot = {
      reference,
      title: 'Delivery — Update',
      kind: 'update',
      context: [
        { kind: 'focus', title: 'Project Atlas' },
        { kind: 'thread', title: 'Delivery' }
      ],
      subject: null,
      updateMetadata: { date: '2026-08-19', state: 'yellow', sensitive: false },
      value: 'Status changed',
      revision: 2,
      updatedAt: '2026-08-19T12:00:00.000Z'
    }
    let listener: ((change: RichTextDocumentChange) => void) | undefined
    const richText = {
      getDocument: vi.fn().mockResolvedValue(initial),
      listHistory: vi.fn().mockResolvedValue([]),
      restoreHistory: vi.fn(async (target) => ({ reference: target, value: '', history: [] })),
      saveDocument: vi.fn(),
      openWindow: vi.fn().mockResolvedValue(undefined),
      getWindowTarget: vi.fn().mockResolvedValue(reference),
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
    await waitFor(() => expect(result.current.value).toBe('Status changed'))
    const hydratedExternalRevision = result.current.externalRevision

    act(() => listener?.({
      document: {
        ...initial,
        updateMetadata: { ...initial.updateMetadata!, state: 'green' },
        updatedAt: '2026-08-19T12:01:00.000Z'
      },
      sourceWindowId: 99
    }))

    expect(result.current.updateMetadata?.state).toBe('green')
    expect(result.current.value).toBe('Status changed')
    expect(result.current.externalRevision).toBe(hydratedExternalRevision)
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
      listHistory: vi.fn().mockResolvedValue([]),
      restoreHistory: vi.fn(async (target) => ({ reference: target, value: '', history: [] })),
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
