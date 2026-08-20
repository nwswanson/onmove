// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  OnMoveApi,
  RichTextHistorySnapshot
} from '../../src/shared/contracts'
import {
  RichTextContentWithHistory,
  RichTextEditorWithHistory
} from '../../src/renderer/src/features/rich-text/rich-text-history'

const reference = { type: 'note', id: 7, field: 'content' } as const
const earlier: RichTextHistorySnapshot = {
  reference,
  revision: 2,
  value: 'Earlier text',
  capturedAt: '2026-08-19T12:00:00.000Z',
  reason: 'large-edit',
  editCount: 3,
  changeSize: 800
}

function installHistoryApi(overrides: Partial<OnMoveApi['richText']> = {}): OnMoveApi['richText'] {
  const richText = {
    getDocument: vi.fn(),
    listHistory: vi.fn().mockResolvedValue([earlier]),
    restoreHistory: vi.fn().mockResolvedValue({
      reference,
      value: earlier.value,
      history: [
        { ...earlier, revision: 3, value: 'Current text', reason: 'restore' as const },
        earlier
      ]
    }),
    saveDocument: vi.fn(),
    openWindow: vi.fn(),
    getWindowTarget: vi.fn(),
    onDocumentChanged: vi.fn(() => () => undefined),
    ...overrides
  } as OnMoveApi['richText']
  Object.defineProperty(window, 'onmove', {
    value: { richText } as unknown as OnMoveApi,
    configurable: true
  })
  return richText
}

describe('RichTextEditorWithHistory', () => {
  it('navigates into a checkpoint, restores it as a new edit, and remains closable', async () => {
    const richText = installHistoryApi()
    const user = userEvent.setup()
    render(
      <RichTextEditorWithHistory
        historyReference={reference}
        value="Current text"
        ariaLabel="Document"
        onChange={() => undefined}
      />
    )

    await user.click(screen.getByRole('button', { name: 'View history' }))
    expect(await screen.findByRole('dialog', { name: 'Text history' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Before a large edit/ }))
    expect(screen.getByLabelText('Historical text revision 2')).toHaveTextContent('Earlier text')

    await user.click(screen.getByRole('button', { name: 'Restore this version' }))
    await waitFor(() => expect(richText.restoreHistory).toHaveBeenCalledWith(reference, 2))
    expect(screen.getByRole('status')).toHaveTextContent('Restored as a new edit')
    expect(screen.getByRole('button', { name: /Before a restore/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog', { name: 'Text history' })).not.toBeInTheDocument()
  })

  it('flushes throttled content before loading history', async () => {
    const richText = installHistoryApi()
    const flush = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <RichTextEditorWithHistory
        historyReference={reference}
        value="Draft"
        ariaLabel="Routine note"
        onChange={() => undefined}
        onBeforeOpenHistory={flush}
      />
    )

    await user.click(screen.getByRole('button', { name: 'View history' }))
    await screen.findByRole('dialog', { name: 'Text history' })
    expect(flush).toHaveBeenCalledOnce()
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(richText.listHistory).mock.invocationCallOrder[0]
    )
  })

  it('omits history entirely when an enclosing modal disables the capability', () => {
    const richText = installHistoryApi()
    render(
      <RichTextEditorWithHistory
        historyReference={reference}
        historyEnabled={false}
        value="Modal draft"
        ariaLabel="Modal document"
        onChange={() => undefined}
      />
    )

    expect(screen.queryByRole('button', { name: 'View history' })).not.toBeInTheDocument()
    expect(richText.listHistory).not.toHaveBeenCalled()
  })

  it('lets finalized rich text inspect history without offering a restore mutation', async () => {
    const richText = installHistoryApi()
    const user = userEvent.setup()
    render(
      <RichTextContentWithHistory
        historyReference={reference}
        value="Finalized evidence"
        ariaLabel="Finalized evidence"
      />
    )

    await user.click(screen.getByRole('button', { name: 'View text history' }))
    await user.click(await screen.findByRole('button', { name: /Before a large edit/ }))
    expect(screen.queryByRole('button', { name: 'Restore this version' })).not.toBeInTheDocument()
    expect(richText.restoreHistory).not.toHaveBeenCalled()
  })
})
