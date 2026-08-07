// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UpdateTable } from '../../src/renderer/src/features/updates/update-table'
import { validateUpdateTableModel } from '../../src/renderer/src/features/updates/update-table-contract'
import { richTextPlainText } from '../../src/renderer/src/components/ui/rich-text-editor'

const states = [
  { value: 'red', label: 'Red', tone: 'danger' as const },
  { value: 'yellow', label: 'Yellow', tone: 'warning' as const },
  { value: 'green', label: 'Green', tone: 'success' as const },
  { value: 'none', label: 'None', tone: 'neutral' as const }
]

describe('UpdateTable', () => {
  it('rejects duplicate rows and unsupported states at its receiver boundary', () => {
    expect(() =>
      validateUpdateTableModel(
        [
          { id: '1', date: '2026-08-07', observation: 'One', state: 'green' },
          { id: '1', date: '2026-08-08', observation: 'Two', state: 'green' }
        ],
        states
      )
    ).toThrow('invalid row "1"')
    expect(() =>
      validateUpdateTableModel(
        [{ id: '1', date: '2026-08-07', observation: 'One', state: 'purple' }],
        states
      )
    ).toThrow('invalid row "1"')
  })

  it('owns inline editing, creation, deletion, and visible state labels', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateTable
        rows={[
          {
            id: '20',
            date: '2026-08-01',
            observation: 'Ticket quality is uneven',
            state: 'yellow'
          }
        ]}
        stateOptions={states}
        defaultDate="2026-08-07"
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    )

    expect(screen.getByRole('table', { name: 'Commitment updates' })).toBeInTheDocument()
    expect(screen.getByText('Yellow', { selector: 'span' })).toHaveClass('text-destructive')
    const observation = screen.getByLabelText('Update observation')
    await user.type(observation, ' and acceptance criteria improved')
    await user.selectOptions(screen.getByLabelText('Update state'), 'green')
    expect(screen.getByText('Green', { selector: 'span' })).toHaveClass('text-success-foreground')
    await user.click(screen.getByRole('button', { name: 'Save update' }))
    expect(onUpdate).toHaveBeenCalledOnce()
    const edited = onUpdate.mock.calls[0][1]
    expect(edited).toMatchObject({ date: '2026-08-01', state: 'green' })
    expect(richTextPlainText(edited.observation)).toBe(
      ' and acceptance criteria improvedTicket quality is uneven'
    )

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    expect(screen.getByLabelText('New update date')).toHaveValue('2026-08-07')
    expect(screen.getByText('None', { selector: 'span' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('New update state'), 'red')
    await user.click(screen.getByRole('button', { name: 'Create update' }))
    expect(onCreate).toHaveBeenCalledWith({
      date: '2026-08-07',
      observation: '',
      state: 'red'
    })

    await user.click(screen.getByRole('button', { name: 'Delete update' }))
    expect(onDelete).toHaveBeenCalledWith('20')
  })

  it('shows receiver-owned loading, empty, and failure states', () => {
    const { rerender } = render(
      <UpdateTable
        rows={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        loading
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Loading updates…')).toBeInTheDocument()
    rerender(
      <UpdateTable
        rows={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        loadError="Updates could not be loaded."
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByText('No updates yet.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Updates could not be loaded.')
  })

  it('autosaves an existing observation after the shared throttle interval', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateTable
        rows={[
          {
            id: '20',
            date: '2026-08-01',
            observation: 'Initial signal',
            state: 'yellow'
          }
        ]}
        stateOptions={states}
        defaultDate="2026-08-07"
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

  it('creates a state-only update without requiring observation text', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateTable
        rows={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await user.selectOptions(screen.getByLabelText('New update state'), 'red')
    await user.click(screen.getByRole('button', { name: 'Create update' }))

    expect(onCreate).toHaveBeenCalledWith({
      date: '2026-08-07',
      observation: '',
      state: 'red'
    })
  })
})
