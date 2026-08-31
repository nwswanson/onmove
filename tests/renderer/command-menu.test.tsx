// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandMenu } from '../../src/renderer/src/components/ui/command-menu'

describe('CommandMenu', () => {
  it('renders active search as a globally ranked list and selects the strongest result', () => {
    const onSelect = vi.fn()
    render(
      <CommandMenu
        open
        label="Jump to anything"
        placeholder="Search…"
        groups={[{
          id: 'focuses',
          label: 'Focuses',
          items: [{
            id: 'focus:1',
            icon: 'folder',
            code: '#F1',
            label: 'Personname planning',
            description: 'Focus · Overall',
            keywords: ['focus', 'personname planning']
          }]
        }, {
          id: 'threads',
          label: 'Threads',
          items: [{
            id: 'thread:2',
            icon: 'branch',
            code: '#T2',
            label: 'Personname',
            description: 'People › All subjects',
            keywords: ['thread', 'personname']
          }]
        }]}
        loading={false}
        error={null}
        onOpenChange={vi.fn()}
        onSelect={onSelect}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'Jump to anything' })
    expect(within(dialog).getByText('Focuses')).toBeInTheDocument()
    expect(within(dialog).getByText('Threads')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByRole('combobox'), {
      target: { value: 'personname' }
    })

    expect(within(dialog).getByText('Best matches')).toBeInTheDocument()
    expect(within(dialog).queryByText('Focuses')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Threads')).not.toBeInTheDocument()
    const options = within(dialog).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('PersonnamePeople › All subjects'),
      expect.stringContaining('Personname planningFocus · Overall')
    ])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.change(within(dialog).getByRole('combobox'), {
      target: { value: '#T2' }
    })
    expect(within(dialog).getAllByRole('option')).toHaveLength(1)
    expect(within(dialog).getByText('#T2')).toBeVisible()
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('thread:2')
  })
})
