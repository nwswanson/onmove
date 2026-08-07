// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UpdateList } from '../../src/renderer/src/features/updates/update-list'
import { validateUpdateListModel } from '../../src/renderer/src/features/updates/update-list-contract'
import { richTextPlainText } from '../../src/renderer/src/components/ui/rich-text-editor'

const states = [
  { value: 'red', label: 'Red', tone: 'danger' as const },
  { value: 'yellow', label: 'Yellow', tone: 'warning' as const },
  { value: 'green', label: 'Green', tone: 'success' as const },
  { value: 'none', label: 'None', tone: 'neutral' as const }
]

describe('UpdateList', () => {
  it('rejects duplicate items and unsupported states at its receiver boundary', () => {
    expect(() =>
      validateUpdateListModel(
        [
          { id: '1', date: '2026-08-07', observation: 'One', state: 'green' },
          { id: '1', date: '2026-08-08', observation: 'Two', state: 'green' }
        ],
        states
      )
    ).toThrow('invalid item "1"')
    expect(() =>
      validateUpdateListModel(
        [{ id: '1', date: '2026-08-07', observation: 'One', state: 'purple' }],
        states
      )
    ).toThrow('invalid item "1"')
  })

  it('owns inline editing, immediate creation, deletion, and visible state labels', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={[
          {
            id: '20',
            date: '2026-08-01',
            observation: 'Ticket quality is uneven',
            state: 'yellow'
          }
        ]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    )

    const list = screen.getByRole('list', { name: 'Test updates' })
    expect(list).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Update from 2026-08-01' })).toBeInTheDocument()
    expect(screen.getByText('Yellow', { selector: 'span' })).toHaveClass('text-destructive')
    const observation = screen.getByLabelText('Update observation')
    await user.type(observation, ' and acceptance criteria improved')
    await user.selectOptions(screen.getByLabelText('Update state'), 'green')
    expect(screen.getByText('Green', { selector: 'span' })).toHaveClass('text-success-foreground')
    expect(screen.queryByRole('button', { name: 'Save update' })).not.toBeInTheDocument()
    await waitFor(() => expect(onUpdate).toHaveBeenCalled(), { timeout: 2_000 })
    const edited = onUpdate.mock.calls.at(-1)?.[1]
    expect(edited).toMatchObject({ date: '2026-08-01', state: 'green' })
    expect(richTextPlainText(edited.observation)).toBe(
      ' and acceptance criteria improvedTicket quality is uneven'
    )

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce())
    expect(onCreate).toHaveBeenCalledWith({
      date: '2026-08-07',
      observation: '',
      state: 'none'
    })
    expect(screen.queryByRole('button', { name: 'Create update' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel new update' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete update' }))
    expect(onDelete).toHaveBeenCalledWith('20')
  })

  it('shows receiver-owned loading, empty, and failure states', () => {
    const { rerender } = render(
      <UpdateList
        ariaLabel="Test updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        loading
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Loading updates…')).toBeInTheDocument()
    rerender(
      <UpdateList
        ariaLabel="Test updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        loadError="Updates could not be loaded."
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByText('No updates yet.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Updates could not be loaded.')
  })

  it('renders a long history as independent full-width editor cards', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      id: String(index + 1),
      date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      observation: `Narrative update ${index + 1}`,
      state: index % 2 === 0 ? 'green' : 'none'
    }))
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={items}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const list = screen.getByRole('list', { name: 'Test updates' })
    expect(list).toHaveClass('space-y-3')
    expect(screen.getAllByRole('listitem')).toHaveLength(12)
    expect(screen.getAllByLabelText('Update observation')).toHaveLength(12)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('autosaves an existing observation after the shared throttle interval', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={[
          {
            id: '20',
            date: '2026-08-01',
            observation: 'Initial signal',
            state: 'yellow'
          }
        ]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    )

    await user.type(screen.getByLabelText('Update observation'), ' improved')
    expect(onUpdate).not.toHaveBeenCalled()
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce(), { timeout: 2_000 })
    expect(richTextPlainText(onUpdate.mock.calls[0][1].observation)).toContain('improved')
  })

  it('autosaves existing date and state fields without a save action', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={[
          {
            id: '20',
            date: '2026-08-01',
            observation: 'Initial signal',
            state: 'yellow'
          }
        ]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    )

    await user.clear(screen.getByLabelText('Update date'))
    await user.type(screen.getByLabelText('Update date'), '2026-08-06')
    await user.selectOptions(screen.getByLabelText('Update state'), 'green')

    expect(screen.queryByRole('button', { name: 'Save update' })).not.toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce(), { timeout: 2_000 })
    const savedDraft = onUpdate.mock.calls[0][1]
    expect(savedDraft).toMatchObject({ date: '2026-08-06', state: 'green' })
    expect(richTextPlainText(savedDraft.observation)).toBe('Initial signal')
  })

  it('immediately persists a blank update when Add update is pressed', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      date: '2026-08-07',
      observation: '',
      state: 'none'
    }))
    expect(screen.queryByLabelText('New update date')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create update' })).not.toBeInTheDocument()
  })

  it('prevents duplicate adds while persistence is pending and exposes creation failures', async () => {
    let rejectCreate: ((reason?: unknown) => void) | undefined
    const onCreate = vi.fn(
      () => new Promise<void>((_resolve, reject) => {
        rejectCreate = reject
      })
    )
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled()
    expect(onCreate).toHaveBeenCalledOnce()
    rejectCreate?.(new Error('database unavailable'))

    expect(await screen.findByRole('alert')).toHaveTextContent('The update could not be added.')
    expect(screen.getByRole('button', { name: 'Add update' })).toBeEnabled()
  })
})
