// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkStatusSelect } from '../../src/renderer/src/features/shared/work-status-select'

describe('WorkStatusSelect', () => {
  it('owns the shared Focus, Thread, and Commitment lifecycle vocabulary', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(
      <WorkStatusSelect
        aria-label="Thread status"
        value="paused"
        onValueChange={onValueChange}
      />
    )

    const select = screen.getByRole('combobox', { name: 'Thread status' })
    expect(select).toHaveValue('paused')
    expect(select).toHaveAttribute('data-status-tone', 'neutral')
    expect(
      screen.getAllByRole('option').map((option) => option.getAttribute('value'))
    ).toEqual(['active', 'paused', 'done', 'cancelled'])

    await user.selectOptions(select, 'done')
    expect(onValueChange).toHaveBeenCalledWith('done')
  })
})
