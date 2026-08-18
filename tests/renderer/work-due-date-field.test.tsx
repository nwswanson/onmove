// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkDueDateField
} from '../../src/renderer/src/features/shared/work-due-date-field'
import { dueDateParentWarning } from '../../src/renderer/src/features/shared/work-due-date'

describe('WorkDueDateField', () => {
  it('warns without rejecting a date after the direct parent due date', () => {
    expect(dueDateParentWarning(
      '2026-09-20',
      { label: 'Thread', dueDate: '2026-09-15' }
    )).toBe(
      'Due date 2026-09-20 is after the parent Thread due date 2026-09-15.'
    )
    expect(dueDateParentWarning(
      '2026-09-15',
      { label: 'Thread', dueDate: '2026-09-15' }
    )).toBeNull()
    expect(dueDateParentWarning('2026-09-20', null)).toBeNull()
  })

  it('renders the parent warning tooltip and can clear a persisted date', async () => {
    const onValueChange = vi.fn().mockResolvedValue(true)
    const user = userEvent.setup()
    render(
      <WorkDueDateField
        entityLabel="Commitment"
        value="2026-09-20"
        parent={{ label: 'Thread', dueDate: '2026-09-15' }}
        onValueChange={onValueChange}
      />
    )

    const warning = screen.getByLabelText(
      'Due date 2026-09-20 is after the parent Thread due date 2026-09-15.'
    )
    expect(warning).toHaveAttribute(
      'title',
      'Due date 2026-09-20 is after the parent Thread due date 2026-09-15.'
    )

    await user.click(screen.getByRole('button', { name: 'Clear Commitment due date' }))
    expect(onValueChange).toHaveBeenCalledWith(null)
    expect(screen.getByLabelText('Commitment due date')).toHaveValue('')
    expect(screen.queryByLabelText(/is after the parent Thread/)).not.toBeInTheDocument()
  })

  it('restores the persisted value when saving fails', async () => {
    const user = userEvent.setup()
    render(
      <WorkDueDateField
        entityLabel="Focus"
        value="2026-09-15"
        onValueChange={vi.fn().mockResolvedValue(false)}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Clear Focus due date' }))
    expect(screen.getByLabelText('Focus due date')).toHaveValue('2026-09-15')
  })

  it('keeps a character-by-character date draft focused until editing finishes', async () => {
    const onValueChange = vi.fn().mockResolvedValue(true)
    const user = userEvent.setup()
    const rendered = render(
      <WorkDueDateField
        entityLabel="Thread"
        value="2026-09-15"
        onValueChange={onValueChange}
      />
    )

    const input = screen.getByLabelText('Thread due date')
    await user.click(input)
    // Native date controls expose the partially entered 01/01/1 as a valid,
    // canonical year before the user has finished editing its year segment.
    fireEvent.change(input, { target: { value: '0001-01-01' } })

    expect(input).toHaveValue('0001-01-01')
    expect(input).toHaveFocus()
    expect(onValueChange).not.toHaveBeenCalled()

    rendered.rerender(
      <WorkDueDateField
        entityLabel="Thread"
        value="2026-09-16"
        onValueChange={onValueChange}
      />
    )
    expect(screen.getByLabelText('Thread due date')).toBe(input)
    expect(input).toHaveValue('0001-01-01')
    expect(input).toHaveFocus()

    fireEvent.blur(input)
    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalledWith('0001-01-01')
    })
  })

  it('synchronizes an externally changed due date while the field is idle', () => {
    const onValueChange = vi.fn().mockResolvedValue(true)
    const rendered = render(
      <WorkDueDateField
        entityLabel="Focus"
        value="2026-09-15"
        onValueChange={onValueChange}
      />
    )

    const input = screen.getByLabelText('Focus due date')
    rendered.rerender(
      <WorkDueDateField
        entityLabel="Focus"
        value="2026-10-01"
        onValueChange={onValueChange}
      />
    )
    expect(screen.getByLabelText('Focus due date')).toBe(input)
    expect(input).toHaveValue('2026-10-01')
  })
})
