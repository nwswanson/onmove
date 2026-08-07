// @vitest-environment jsdom

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ContextualSidebar,
  ContextualSidebarLevel,
  ContextualSidebarNavigation,
  type ContextualSidebarNewItemAction,
  useContextualSidebarNavigation
} from '../../src/renderer/src/components/ui/contextual-sidebar'

interface TestItem {
  id: string
  label: string
  disabled?: boolean
}

function level(
  id: string,
  title: string,
  items: readonly TestItem[] | (() => readonly TestItem[]),
  options: {
    parent?: ContextualSidebarLevel<TestItem>
    parentItemId?: string
    onSelect?: (item: TestItem) => void
    getItemGroup?: (item: TestItem) => { id: string; label: string } | null
    newItem?: ContextualSidebarNewItemAction
    footer?: React.ReactNode
  } = {}
): ContextualSidebarLevel<TestItem> {
  return new ContextualSidebarLevel({
    id,
    title,
    ariaLabel: title,
    parent: options.parent,
    parentItemId: options.parentItemId,
    items,
    getItemId: (item) => item.id,
    getItemAriaLabel: (item) => item.label,
    getItemGroup: options.getItemGroup,
    isItemDisabled: (item) => item.disabled ?? false,
    renderItem: (item, state) => (
      <span>
        {item.label}
        <span aria-hidden="true">{state.selected ? ' selected' : ''}</span>
      </span>
    ),
    newItem: options.newItem,
    footer: options.footer,
    onSelect: options.onSelect
  })
}

function SelectionProbe({
  navigation,
  levels
}: {
  navigation: ContextualSidebarNavigation
  levels: readonly ContextualSidebarLevel<TestItem>[]
}): React.JSX.Element {
  const snapshot = useContextualSidebarNavigation(navigation)
  const currentLevel = levels.find((candidate) => candidate === snapshot.level)
  const selected =
    currentLevel && snapshot.selectedItemId
      ? currentLevel.getItem(snapshot.selectedItemId)
      : undefined
  return <output aria-label="Main selection">{selected?.label ?? 'No selection'}</output>
}

describe('ContextualSidebarNavigation', () => {
  it('lets a parentless root assert items and select its first item', () => {
    const root = level('focus:1', 'Threads', [
      { id: 'sprint', label: 'Sprint execution' },
      { id: 'health', label: 'Team health' }
    ])
    const navigation = new ContextualSidebarNavigation(root)

    expect(root.parent).toBeNull()
    expect(root.getItemIds()).toEqual(['sprint', 'health'])
    expect(navigation.getSnapshot()).toMatchObject({
      level: root,
      parent: null,
      canGoBack: false,
      selectedItemId: 'sprint'
    })
    expect(navigation.back()).toBe(false)
  })

  it('lets any level declare a generic bottom new-item action', async () => {
    const onNewThread = vi.fn()
    const root = level(
      'focus:1',
      'Focus',
      [
        { id: 'overall', label: 'Overall' },
        { id: 'sprint', label: 'Sprint execution' }
      ],
      {
        getItemGroup: (item) =>
          item.id === 'overall'
            ? { id: 'focus', label: 'Focus' }
            : { id: 'threads', label: 'Threads' },
        newItem: { label: 'New thread', onCreate: onNewThread }
      }
    )
    const navigation = new ContextualSidebarNavigation(root)
    const user = userEvent.setup()
    render(<ContextualSidebar navigation={navigation} />)

    expect(screen.getByText('Focus', { selector: '[data-slot="sidebar-group-label"]' })).toBeInTheDocument()
    expect(screen.getByText('Threads', { selector: '[data-slot="sidebar-group-label"]' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New thread' }))
    expect(onNewThread).toHaveBeenCalledOnce()
  })

  it('replaces levels, retains each parent selection, and navigates back globally', async () => {
    const onThreadSelect = vi.fn()
    const root = level(
      'focus:1',
      'Threads',
      [
        { id: 'sprint', label: 'Sprint execution' },
        { id: 'health', label: 'Team health' }
      ],
      { onSelect: onThreadSelect }
    )
    const commitments = level(
      'thread:sprint:commitments',
      'Commitments',
      [
        { id: 'quality', label: 'Improve ticket quality' },
        { id: 'review', label: 'Hold weekly refinement' }
      ],
      { parent: root, parentItemId: 'health' }
    )
    const navigation = new ContextualSidebarNavigation(root)
    const user = userEvent.setup()
    render(
      <>
        <ContextualSidebar navigation={navigation} />
        <SelectionProbe navigation={navigation} levels={[root, commitments]} />
      </>
    )

    const contextualSidebar = screen.getByLabelText('Contextual sidebar')
    expect(within(contextualSidebar).queryByRole('button', { name: /Back/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sprint execution' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByLabelText('Main selection')).toHaveTextContent('Sprint execution')

    await user.click(screen.getByRole('button', { name: 'Team health' }))
    expect(onThreadSelect).toHaveBeenCalledWith({ id: 'health', label: 'Team health' })
    expect(screen.getByRole('button', { name: 'Team health' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByLabelText('Main selection')).toHaveTextContent('Team health')

    act(() => navigation.navigateTo(commitments))
    expect(screen.getByRole('navigation', { name: 'Commitments' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Team health' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Improve ticket quality' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByLabelText('Main selection')).toHaveTextContent('Improve ticket quality')

    await user.click(screen.getByRole('button', { name: 'Back to Threads' }))
    expect(screen.getByRole('navigation', { name: 'Threads' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Team health' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByLabelText('Main selection')).toHaveTextContent('Team health')
  })

  it('requires every entered level to assert the current level as its parent', () => {
    const root = level('focus:1', 'Threads', [
      { id: 'sprint', label: 'Sprint execution' },
      { id: 'health', label: 'Team health' }
    ])
    const otherRoot = level('focus:2', 'Other threads', [
      { id: 'other', label: 'Other thread' }
    ])
    const unrelatedChild = level('thread:other', 'Commitments', [], {
      parent: otherRoot,
      parentItemId: 'other'
    })
    const navigation = new ContextualSidebarNavigation(root)

    expect(() => level('thread:missing-parent-item', 'Commitments', [], { parent: root })).toThrow(
      'must assert an item from its parent level'
    )
    expect(() => navigation.navigateTo(unrelatedChild)).toThrow(
      'must assert the current level "focus:1" as its parent'
    )
    expect(() => new ContextualSidebarNavigation(unrelatedChild)).toThrow(
      'must start with a top-level parentless level'
    )

    const sprintCommitments = level('thread:sprint', 'Commitments', [], {
      parent: root,
      parentItemId: 'sprint'
    })
    navigation.select('health')
    expect(() => navigation.navigateTo(sprintCommitments)).toThrow(
      'asserts parent item "sprint", but "health" is selected'
    )
  })

  it('rejects duplicate item and ancestor level identifiers', () => {
    expect(() =>
      level('focus:1', 'Threads', [
        { id: 'duplicate', label: 'One' },
        { id: 'duplicate', label: 'Two' }
      ])
    ).toThrow('contains duplicate item id "duplicate"')

    const root = level('focus:1', 'Threads', [{ id: 'sprint', label: 'Sprint execution' }])
    expect(() =>
      level('focus:1', 'Commitments', [], { parent: root, parentItemId: 'sprint' })
    ).toThrow(
      'repeats in its parent path'
    )
  })

  it('reconciles selection when dynamic items are removed', () => {
    let items: TestItem[] = [
      { id: 'sprint', label: 'Sprint execution' },
      { id: 'health', label: 'Team health' }
    ]
    const root = level('focus:1', 'Threads', () => items)
    const navigation = new ContextualSidebarNavigation(root)

    expect(navigation.select('health')).toBe(true)
    items = [{ id: 'sprint', label: 'Sprint execution' }]
    navigation.refresh()
    expect(navigation.getSnapshot().selectedItemId).toBe('sprint')

    items = []
    navigation.refresh()
    expect(navigation.getSnapshot().selectedItemId).toBeNull()
  })

  it('does not select disabled items and reports missing selections', () => {
    const root = level('focus:1', 'Threads', [
      { id: 'sprint', label: 'Sprint execution' },
      { id: 'disabled', label: 'Unavailable', disabled: true }
    ])
    const navigation = new ContextualSidebarNavigation(root)

    expect(navigation.select('disabled')).toBe(false)
    expect(navigation.getSnapshot().selectedItemId).toBe('sprint')
    expect(() => navigation.select('missing')).toThrow('Cannot select missing item "missing"')
  })
})
