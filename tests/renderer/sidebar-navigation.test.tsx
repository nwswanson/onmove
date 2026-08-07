// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SidebarNavigation } from '../../src/renderer/src/components/ui/sidebar-navigation'

describe('SidebarNavigation', () => {
  it('renders only its receiver-owned row contract and reports selected ids', async () => {
    const onSelect = vi.fn()
    const onAdd = vi.fn()
    const user = userEvent.setup()
    render(
      <SidebarNavigation
        items={[
          { id: '1', label: 'Active focus', icon: 'item' },
          {
            id: '2',
            label: 'Paused focus',
            ariaLabel: 'Paused focus, paused',
            icon: 'paused',
            tone: 'muted'
          }
        ]}
        selectedItemId="1"
        onSelect={onSelect}
        action={{ id: 'new', label: 'New focus', icon: 'add', onInvoke: onAdd }}
      />
    )

    expect(screen.getByRole('button', { name: 'Active focus' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('button', { name: 'Paused focus, paused' })).toHaveClass('opacity-55')
    await user.click(screen.getByRole('button', { name: 'Paused focus, paused' }))
    await user.click(screen.getByRole('button', { name: 'New focus' }))
    expect(onSelect).toHaveBeenCalledWith('2')
    expect(onAdd).toHaveBeenCalledOnce()
  })

  it('owns the empty representation', () => {
    render(
      <SidebarNavigation
        items={[]}
        selectedItemId={null}
        emptyLabel="No focuses yet"
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('No focuses yet')).toBeInTheDocument()
  })
})
