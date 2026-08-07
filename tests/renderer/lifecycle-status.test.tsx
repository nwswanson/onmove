// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  LifecycleStatusLabel,
  LifecycleStatusSelect,
  type LifecycleStatusOptionModel
} from '../../src/renderer/src/components/ui/lifecycle-status'

const options: readonly LifecycleStatusOptionModel[] = [
  { value: 'active', label: 'Active', tone: 'primary' },
  { value: 'paused', label: 'Paused', tone: 'neutral' },
  { value: 'done', label: 'Done', tone: 'success' },
  { value: 'cancelled', label: 'Cancelled', tone: 'danger' }
]

describe('LifecycleStatus', () => {
  it('renders a compact, read-only lifecycle label', () => {
    render(<LifecycleStatusLabel model={options[2]} size="compact" />)

    expect(screen.getByText('Done')).toHaveAttribute('data-status-tone', 'success')
  })

  it('renders all choices and delegates a selected value', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(
      <LifecycleStatusSelect
        aria-label="Commitment status"
        value="active"
        options={options}
        onValueChange={onValueChange}
      />
    )

    const select = screen.getByRole('combobox', { name: 'Commitment status' })
    expect(select).toHaveValue('active')
    expect(select).toHaveAttribute('data-status-tone', 'primary')
    expect(screen.getAllByRole('option')).toHaveLength(4)

    await user.selectOptions(select, 'cancelled')
    expect(onValueChange).toHaveBeenCalledWith('cancelled')
  })

  it('rejects a selected value missing from the receiver contract', () => {
    expect(() =>
      render(
        <LifecycleStatusSelect
          aria-label="Commitment status"
          value="unknown"
          options={options}
          onValueChange={() => undefined}
        />
      )
    ).toThrow('Lifecycle status selector has no option for value "unknown".')
  })
})
