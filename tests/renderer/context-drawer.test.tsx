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
                  {
                    kind: 'checkbox',
                    id: 'needs-review',
                    label: 'Needs review',
                    value: true,
                    description: 'Include this item in review workflows.'
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
    await user.click(screen.getByLabelText('Needs review'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(save).toHaveBeenCalledOnce()
    const values = save.mock.calls[0][0]
    expect(values).toMatchObject({
      title: 'Revised',
      status: 'paused',
      'needs-review': false
    })
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

  it('owns positive whole-number validation for editable drawer fields', async () => {
    vi.useFakeTimers()
    const autosave = vi.fn().mockResolvedValue(undefined)
    try {
      render(
        <ContextDrawerOutlet
          open
          adapter={{
            id: 'thread:2',
            invalidationKeys: ['thread:2'],
            model: {
              title: 'Thread',
              ariaLabel: 'Thread drawer',
              sections: [{
                id: 'details',
                fields: [{
                  kind: 'number',
                  id: 'review-frequency',
                  label: 'Review every (days)',
                  value: '7',
                  required: true,
                  min: 1,
                  step: 1,
                  integer: true
                }]
              }],
              autosave: {
                fieldIds: ['review-frequency'],
                errorMessage: 'Could not autosave.',
                onInvoke: autosave
              },
              actions: [{
                id: 'save',
                label: 'Save',
                requiresValidFields: true,
                errorMessage: 'Could not save.',
                onInvoke: vi.fn()
              }]
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

      const frequency = screen.getByRole('spinbutton', { name: /^Review every \(days\)/ })
      fireEvent.change(frequency, { target: { value: '0' } })
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      fireEvent.change(frequency, { target: { value: '1.5' } })
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(autosave).not.toHaveBeenCalled()

      fireEvent.change(frequency, { target: { value: '14' } })
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TEXT_AUTOSAVE_INTERVAL_MS)
      })
      expect(autosave).toHaveBeenCalledWith({ 'review-frequency': '14' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('owns immediate choice cards and conditionally visible token-list editing', async () => {
    const changeMode = vi.fn().mockResolvedValue(undefined)
    const add = vi.fn().mockResolvedValue(undefined)
    const remove = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <ContextDrawerOutlet
        open
        adapter={{
          id: 'thread:2',
          invalidationKeys: ['thread:2'],
          model: {
            title: 'Thread',
            ariaLabel: 'Thread drawer',
            sections: [{
              id: 'scope',
              fields: [
                {
                  kind: 'choice',
                  id: 'scope-mode',
                  label: 'Scope definition',
                  value: 'inherited',
                  options: [
                    { value: 'inherited', label: 'Inherit Focus scope' },
                    { value: 'custom', label: 'Custom scope' }
                  ],
                  errorMessage: 'Could not change mode.',
                  onValueChange: changeMode
                },
                {
                  kind: 'token-list',
                  id: 'subjects',
                  label: 'Subjects in custom scope',
                  items: [{ id: '40', label: 'Customer Operations' }],
                  suggestions: [{ id: '41', label: 'Platform Team' }],
                  inputLabel: 'Add a Subject to custom scope',
                  errorMessage: 'Could not change Subjects.',
                  visibleWhen: { fieldId: 'scope-mode', equals: 'custom' },
                  onAdd: add,
                  onRemove: remove
                }
              ]
            }]
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

    expect(screen.getByRole('radio', { name: 'Inherit Focus scope' })).toBeChecked()
    expect(screen.queryByLabelText('Add a Subject to custom scope')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Custom scope' }))
    expect(changeMode).toHaveBeenCalledWith('custom')
    expect(screen.getByRole('radio', { name: 'Custom scope' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Remove Customer Operations' }))
    expect(remove).toHaveBeenCalledWith('40')
    await user.click(screen.getByRole('button', { name: 'Add Platform Team' }))
    expect(add).toHaveBeenCalledWith('Platform Team')
    await user.type(screen.getByLabelText('Add a Subject to custom scope'), 'Delivery Partners')
    await user.click(screen.getByRole('button', { name: /^Add$/ }))
    expect(add).toHaveBeenCalledWith('Delivery Partners')
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
