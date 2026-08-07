// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ContextDrawerOutlet,
  contextDrawerReducer,
  initialContextDrawerState,
  validateContextDrawerModel,
  type ContextDrawerAdapter
} from '../../src/renderer/src/components/ui/context-drawer'
import {
  isRichText,
  richTextPlainText
} from '../../src/renderer/src/components/ui/rich-text-editor'
import { TEXT_AUTOSAVE_INTERVAL_MS } from '../../src/renderer/src/lib/use-throttled-autosave'

function adapter(id: string, title: string): ContextDrawerAdapter {
  return {
    id,
    invalidationKeys: [id],
    model: {
      title,
      ariaLabel: `${title} drawer`,
      sections: [{ id: 'settings', fields: [], note: `${title} settings` }]
    }
  }
}

describe('ContextDrawerOutlet', () => {
  it('rejects malformed receiver models before rendering them', () => {
    expect(() =>
      validateContextDrawerModel({
        title: 'Commitment',
        ariaLabel: 'Commitment drawer',
        sections: [
          {
            id: 'details',
            fields: [
              { kind: 'static', id: 'title', label: 'Title', value: 'One' },
              { kind: 'static', id: 'title', label: 'Duplicate', value: 'Two' }
            ]
          }
        ]
      })
    ).toThrow('duplicate field id "title"')
  })

  it('owns editable-field rendering, draft state, validation, and action dispatch', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <ContextDrawerOutlet
        open
        adapter={{
          id: 'commitment:2',
          invalidationKeys: ['commitment:2'],
          model: {
            title: 'Commitment',
            ariaLabel: 'Commitment drawer',
            sections: [
              {
                id: 'details',
                fields: [
                  { kind: 'text', id: 'title', label: 'Title', value: 'Initial', required: true },
                  {
                    kind: 'rich-text',
                    id: 'notes',
                    label: 'Notes',
                    value: 'Existing notes'
                  },
                  {
                    kind: 'select',
                    id: 'status',
                    label: 'Status',
                    value: 'active',
                    options: [
                      { value: 'active', label: 'Active' },
                      { value: 'paused', label: 'Paused' }
                    ]
                  },
                  { kind: 'static', id: 'parent', label: 'Parent', value: 'Focus — Atlas' }
                ]
              }
            ],
            actions: [
              {
                id: 'save',
                label: 'Save',
                requiresValidFields: true,
                errorMessage: 'Could not save.',
                onInvoke: save
              }
            ]
          }
        }}
        pinnedAdapter={null}
        width={320}
        minWidth={280}
        maxWidth={384}
        onWidthChange={vi.fn()}
        onClose={vi.fn()}
        onUnpin={vi.fn()}
      />
    )

    const title = screen.getByLabelText(/^Title/)
    expect(screen.getByText('Focus — Atlas')).toBeInTheDocument()
    await user.clear(title)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(title, 'Revised')
    await user.type(screen.getByLabelText('Notes'), ' updated')
    await user.selectOptions(screen.getByLabelText('Status'), 'paused')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(save).toHaveBeenCalledOnce()
    const values = save.mock.calls[0][0]
    expect(values).toMatchObject({ title: 'Revised', status: 'paused' })
    expect(isRichText(values.notes)).toBe(true)
    expect(richTextPlainText(values.notes)).toBe(' updatedExisting notes')
  })

  it('applies the receiver-owned autosave contract to declared text fields', async () => {
    vi.useFakeTimers()
    const autosave = vi.fn().mockResolvedValue(undefined)
    try {
      render(
        <ContextDrawerOutlet
          open
          adapter={{
            id: 'focus:1',
            invalidationKeys: ['focus:1'],
            model: {
              title: 'Focus',
              ariaLabel: 'Focus drawer',
              sections: [
                {
                  id: 'details',
                  fields: [
                    { kind: 'text', id: 'title', label: 'Title', value: 'Initial', required: true }
                  ]
                }
              ],
              autosave: {
                fieldIds: ['title'],
                errorMessage: 'Could not autosave.',
                onInvoke: autosave
              }
            }
          }}
          pinnedAdapter={null}
          width={320}
          minWidth={280}
          maxWidth={384}
          onWidthChange={vi.fn()}
          onClose={vi.fn()}
          onUnpin={vi.fn()}
        />
      )

      fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Revised' } })
      act(() => vi.advanceTimersByTime(TEXT_AUTOSAVE_INTERVAL_MS - 1))
      expect(autosave).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(autosave).toHaveBeenCalledWith({ title: 'Revised' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders the shared empty representation when an active screen has no adapter', async () => {
    const onClose = vi.fn()
    const onWidthChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ContextDrawerOutlet
        open
        adapter={null}
        pinnedAdapter={null}
        width={320}
        minWidth={280}
        maxWidth={384}
        onWidthChange={onWidthChange}
        onClose={onClose}
        onUnpin={vi.fn()}
      />
    )

    expect(screen.getByRole('complementary', { name: 'Context drawer' })).toHaveStyle({
      width: '320px'
    })
    expect(screen.getByText('No settings here.')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize context drawer' }), {
      key: 'ArrowLeft'
    })
    expect(onWidthChange).toHaveBeenCalledWith(336)
    await user.click(screen.getByRole('button', { name: 'Close context drawer' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('replaces screen-owned adapters without owning or closing persistent open state', () => {
    const sharedProps = {
      open: true,
      width: 336,
      minWidth: 280,
      maxWidth: 384,
      onWidthChange: vi.fn(),
      onClose: vi.fn(),
      pinnedAdapter: null,
      onUnpin: vi.fn()
    }
    const { rerender } = render(
      <ContextDrawerOutlet adapter={adapter('focus:1', 'Focus')} {...sharedProps} />
    )

    expect(screen.getByRole('complementary', { name: 'Focus drawer' })).toBeInTheDocument()
    rerender(<ContextDrawerOutlet adapter={adapter('thread:1', 'Thread')} {...sharedProps} />)

    expect(screen.queryByRole('complementary', { name: 'Focus drawer' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Thread drawer' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize context drawer' })).toBeInTheDocument()
    expect(sharedProps.onClose).not.toHaveBeenCalled()
  })

  it('renders nothing while the persistent outlet is closed', () => {
    render(
      <ContextDrawerOutlet
        open={false}
        adapter={adapter('focus:1', 'Focus')}
        pinnedAdapter={null}
        width={336}
        minWidth={280}
        maxWidth={384}
        onWidthChange={vi.fn()}
        onClose={vi.fn()}
        onUnpin={vi.fn()}
      />
    )

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('keeps a pinned adapter across active-screen changes until explicitly unpinned', async () => {
    const onUnpin = vi.fn()
    const user = userEvent.setup()
    const props = {
      open: true,
      adapter: adapter('focus:1', 'Focus'),
      pinnedAdapter: adapter('commitment:2', 'Commitment'),
      width: 336,
      minWidth: 280,
      maxWidth: 384,
      onWidthChange: vi.fn(),
      onClose: vi.fn(),
      onUnpin
    }
    const { rerender } = render(<ContextDrawerOutlet {...props} />)

    expect(screen.getByRole('complementary', { name: 'Commitment drawer' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Focus drawer' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unpin drawer and follow current selection' }))
    expect(onUnpin).toHaveBeenCalledOnce()

    rerender(
      <ContextDrawerOutlet
        {...props}
        adapter={adapter('thread:3', 'Thread')}
      />
    )
    expect(screen.getByRole('complementary', { name: 'Commitment drawer' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Thread drawer' })).not.toBeInTheDocument()
    expect(onUnpin).toHaveBeenCalledOnce()
  })
})

describe('contextDrawerReducer deletion lifecycle', () => {
  it('preserves a pin while hidden or navigating and releases it only when unpinned', () => {
    const pinned = adapter('commitment:2', 'Commitment')
    const pinnedState = contextDrawerReducer(initialContextDrawerState, {
      type: 'pin',
      adapter: pinned
    })
    const closedState = contextDrawerReducer(pinnedState, { type: 'close' })

    expect(closedState).toEqual({ open: false, pinnedAdapter: pinned })
    expect(contextDrawerReducer(closedState, { type: 'toggle' })).toEqual({
      open: true,
      pinnedAdapter: pinned
    })
    expect(contextDrawerReducer(pinnedState, { type: 'unpin' })).toEqual({
      open: true,
      pinnedAdapter: null
    })
  })

  it('keeps unrelated pins but unpins a deleted target or owning ancestor without closing', () => {
    const pinned: ContextDrawerAdapter = {
      ...adapter('commitment:2', 'Commitment'),
      invalidationKeys: ['focus:1', 'thread:4', 'commitment:2']
    }
    const pinnedState = { open: true, pinnedAdapter: pinned }

    expect(
      contextDrawerReducer(pinnedState, { type: 'invalidate', keys: ['focus:99'] })
    ).toBe(pinnedState)
    expect(
      contextDrawerReducer(pinnedState, { type: 'invalidate', keys: ['commitment:2'] })
    ).toEqual({ open: true, pinnedAdapter: null })
    expect(
      contextDrawerReducer(pinnedState, { type: 'invalidate', keys: ['focus:1'] })
    ).toEqual({ open: true, pinnedAdapter: null })
  })
})
