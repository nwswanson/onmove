// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SidebarNavigation } from '../../src/renderer/src/components/ui/sidebar-navigation'

describe('SidebarNavigation', () => {
  it('renders only its receiver-owned row contract and reports selected ids', async () => {
    const onSelect = vi.fn()
    const onAdd = vi.fn()
    const onArchive = vi.fn()
    const user = userEvent.setup()
    render(
      <SidebarNavigation
        items={[
          {
            id: '1',
            label: 'Active focus',
            icon: 'sunflower',
            sunflower: {
              ariaLabel: 'Overall Green; one active commitment Red',
              seeds: [
                { id: 'overall', label: 'Overall: Green', tone: 'success' },
                { id: 'commitment:1', label: 'Blocked work: Red', tone: 'danger' }
              ]
            }
          },
          {
            id: '2',
            label: 'Paused focus',
            ariaLabel: 'Paused focus, paused',
            icon: 'paused',
            tone: 'muted',
            badge: { value: 3, label: '3 remaining' }
          }
        ]}
        selectedItemId="1"
        onSelect={onSelect}
        actions={[
          { id: 'new', label: 'New focus', icon: 'add', onInvoke: onAdd },
          { id: 'archive', label: 'Archive', icon: 'archive', onInvoke: onArchive }
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Active focus' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    const sunflower = screen.getByRole('img', {
      name: 'Overall Green; one active commitment Red'
    })
    expect(sunflower).toHaveAttribute('width', '24')
    expect(sunflower).toHaveAttribute('height', '24')
    expect(sunflower.querySelectorAll('[data-seed-index]')).toHaveLength(2)
    expect(sunflower.querySelector('[data-seed-index="0"]')).toHaveAttribute(
      'fill',
      'var(--success)'
    )
    expect(sunflower.querySelector('[data-seed-index="1"]')).toHaveAttribute(
      'fill',
      'var(--destructive)'
    )
    const paused = screen.getByRole('button', { name: 'Paused focus, paused, 3 remaining' })
    expect(paused).toHaveClass('opacity-55')
    expect(within(paused)
      .getByText('3')).toBeVisible()
    await user.click(paused)
    await user.click(screen.getByRole('button', { name: 'New focus' }))
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(onSelect).toHaveBeenCalledWith('2')
    expect(onAdd).toHaveBeenCalledOnce()
    expect(onArchive).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Archive' }).querySelector('.lucide-archive'))
      .toBeInTheDocument()
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

  it('reads a generic context menu from its target item', async () => {
    const onContextMenuAction = vi.fn()
    const user = userEvent.setup()
    render(
      <SidebarNavigation
        items={[{
          id: 'focus:1',
          label: 'Project Atlas',
          contextMenu: {
            ariaLabel: 'Project Atlas actions',
            items: [
              { kind: 'checkbox', id: 'sensitive', label: 'Sensitive', checked: false },
              {
                kind: 'action',
                id: 'delete',
                label: 'Delete Focus',
                tone: 'destructive',
                separatorBefore: true
              }
            ]
          }
        }]}
        selectedItemId="focus:1"
        onSelect={vi.fn()}
        onContextMenuAction={onContextMenuAction}
      />
    )

    const target = screen.getByRole('button', { name: 'Project Atlas' })
    fireEvent.contextMenu(target)
    let menu = await screen.findByRole('menu', { name: 'Project Atlas actions' })
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Sensitive' }))
    expect(onContextMenuAction).toHaveBeenCalledWith('focus:1', 'sensitive', true)

    fireEvent.contextMenu(target)
    menu = await screen.findByRole('menu', { name: 'Project Atlas actions' })
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete Focus' }))
    expect(onContextMenuAction).toHaveBeenLastCalledWith('focus:1', 'delete', undefined)
  })
})
