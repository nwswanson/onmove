// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceTabBar } from '../../src/renderer/src/components/ui/workspace-tab-bar'

const model = {
  label: 'Working context',
  ariaLabel: 'Thread working context',
  items: [
    { id: 'all', label: 'All subjects', meta: 'Complete history' },
    {
      id: 'subject:40',
      label: 'Customer Operations',
      accessibleLabel: 'Work in Customer Operations',
      meta: 'Last reviewed · 2026-08-07',
      stateLabel: { label: 'Red', tone: 'danger' as const },
      attentionLabel: 'Review due'
    },
    {
      id: 'subject:41',
      label: 'Platform Team',
      accessibleLabel: 'Work in Platform Team',
      meta: 'Last reviewed · Never',
      stateLabel: { label: 'Green', tone: 'success' as const }
    }
  ]
}

describe('WorkspaceTabBar', () => {
  it('renders receiver-owned tab semantics and visible context metadata', () => {
    render(<WorkspaceTabBar model={model} selectedId="subject:40" onSelect={vi.fn()} />)

    expect(screen.getByRole('tablist', { name: 'Thread working context' })).toBeVisible()
    expect(screen.getByText('Working context')).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Work in Customer Operations' }))
      .toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Last reviewed · 2026-08-07')).toBeVisible()
    expect(screen.getByText('Review due')).toBeVisible()
    expect(screen.getByText('Red', { selector: '[data-tone="danger"]' })).toBeVisible()
  })

  it('selects by click and supports arrow, Home, and End navigation', () => {
    const onSelect = vi.fn()
    render(<WorkspaceTabBar model={model} selectedId="all" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Work in Customer Operations' }))
    expect(onSelect).toHaveBeenLastCalledWith('subject:40')

    const all = screen.getByRole('tab', { name: 'All subjects' })
    fireEvent.keyDown(all, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('subject:40')

    fireEvent.keyDown(all, { key: 'End' })
    expect(onSelect).toHaveBeenLastCalledWith('subject:41')

    fireEvent.keyDown(all, { key: 'Home' })
    expect(onSelect).toHaveBeenLastCalledWith('all')
  })
})
