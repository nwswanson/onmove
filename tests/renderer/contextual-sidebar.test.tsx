// @vitest-environment jsdom

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ContextualSidebar,
  ContextualSidebarLevel,
  ContextualSidebarNavigation,
  type ContextualSidebarChildCollectionModel,
  type ContextualSidebarChildMove,
  type ContextualSidebarItemMove,
  type ContextualSidebarNewItemAction,
  useContextualSidebarNavigation
} from '../../src/renderer/src/components/ui/contextual-sidebar'
import type { StateLabelModel } from '../../src/renderer/src/components/ui/state-label'

interface TestItem {
  id: string
  label: string
  description?: string
  disabled?: boolean
  movable?: boolean
  stateLabel?: StateLabelModel
  childCollection?: ContextualSidebarChildCollectionModel
}

function level(
  id: string,
  title: string,
  items: readonly TestItem[] | (() => readonly TestItem[]),
  options: {
    parent?: ContextualSidebarLevel
    parentItemId?: string
    onSelect?: (itemId: string) => void
    onSelectChild?: (
      parentItemId: string,
      collectionId: string,
      childItemId: string
    ) => void
    onChildCollectionAction?: (
      parentItemId: string,
      collectionId: string,
      actionId: string
    ) => void
    canMoveChild?: (move: ContextualSidebarChildMove) => boolean
    onMoveChild?: (move: ContextualSidebarChildMove) => void
    itemMoveTargetType?: string
    canMoveItem?: (move: ContextualSidebarItemMove) => boolean
    onMoveItem?: (move: ContextualSidebarItemMove) => void
    getItemGroup?: (item: TestItem) => { id: string; label: string } | null
    newItem?: ContextualSidebarNewItemAction
  } = {}
): ContextualSidebarLevel {
  const resolveItems = (): TestItem[] => {
    const resolved = typeof items === 'function' ? items() : items
    return resolved.map((item) => ({
      ...item,
      group: options.getItemGroup?.(item) ?? undefined
    }))
  }
  return new ContextualSidebarLevel({
    id,
    title,
    ariaLabel: title,
    parent: options.parent,
    parentItemId: options.parentItemId,
    items: typeof items === 'function' ? resolveItems : resolveItems(),
    newItem: options.newItem,
    onSelect: options.onSelect,
    onSelectChild: options.onSelectChild,
    onChildCollectionAction: options.onChildCollectionAction,
    canMoveChild: options.canMoveChild,
    onMoveChild: options.onMoveChild,
    itemMoveTargetType: options.itemMoveTargetType,
    canMoveItem: options.canMoveItem,
    onMoveItem: options.onMoveItem
  })
}

function SelectionProbe({
  navigation,
  levels
}: {
  navigation: ContextualSidebarNavigation
  levels: readonly ContextualSidebarLevel[]
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

  it('renders an item state through the sidebar-owned state-label receiver', () => {
    const root = level('commitments', 'Commitments', [
      {
        id: 'quality',
        label: 'Improve ticket quality',
        description: 'Last updated · 2026-08-07',
        stateLabel: { label: 'Red', tone: 'danger' }
      }
    ])
    render(<ContextualSidebar navigation={new ContextualSidebarNavigation(root)} />)

    const item = screen.getByRole('button', { name: 'Improve ticket quality' })
    expect(within(item).getByText('Red', { selector: '[data-tone="danger"]' })).toHaveClass(
      'bg-destructive'
    )
    expect(within(item).getByText('Last updated · 2026-08-07')).toBeInTheDocument()
  })

  it('owns nested collection trees and selects a child without replacing its level', async () => {
    const onSelect = vi.fn()
    const onSelectChild = vi.fn()
    const onChildCollectionAction = vi.fn()
    const root = level(
      'focus:1',
      'Focus',
      [
        {
          id: 'overall',
          label: 'Overall',
          childCollection: {
            id: 'commitments',
            label: 'Commitments',
            action: {
              id: 'add',
              label: 'Add commitment',
              ariaLabel: 'Add commitment to Overall'
            },
            items: [
              {
                id: 'quality',
                label: 'Improve ticket quality',
                ariaLabel: 'Open commitment Improve ticket quality',
                state: { label: 'Red', tone: 'danger' }
              }
            ]
          }
        }
      ],
      { onSelect, onSelectChild, onChildCollectionAction }
    )
    const navigation = new ContextualSidebarNavigation(root)
    const user = userEvent.setup()
    render(<ContextualSidebar navigation={navigation} />)

    expect(screen.getByRole('list', { name: 'Overall Commitments' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Commitments' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Red state' })).toHaveAttribute(
      'data-tone',
      'danger'
    )

    await user.click(
      screen.getByRole('button', { name: 'Open commitment Improve ticket quality' })
    )

    expect(screen.getByLabelText('Contextual sidebar')).toHaveAttribute(
      'data-level-id',
      'focus:1'
    )
    expect(
      screen.getByRole('button', { name: 'Open commitment Improve ticket quality' })
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Overall' })).not.toHaveAttribute(
      'aria-current'
    )
    expect(navigation.getSnapshot().selectedChild).toEqual({
      parentItemId: 'overall',
      collectionId: 'commitments',
      childItemId: 'quality'
    })
    expect(onSelect).toHaveBeenCalledWith('overall')
    expect(onSelectChild).toHaveBeenCalledWith(
      'overall',
      'commitments',
      'quality'
    )

    await user.click(
      screen.getByRole('button', { name: 'Add commitment to Overall' })
    )
    expect(onChildCollectionAction).toHaveBeenCalledWith(
      'overall',
      'commitments',
      'add'
    )
    expect(navigation.getSnapshot().level).toBe(root)
  })

  it('makes only nested children draggable and reparentable through its generic contract', () => {
    const onMoveChild = vi.fn()
    const root = level(
      'focus:1',
      'Focus',
      [
        {
          id: 'overall',
          label: 'Overall',
          childCollection: {
            id: 'commitments',
            label: 'Commitments',
            items: [{ id: 'quality', label: 'Improve ticket quality' }]
          }
        },
        {
          id: 'thread:2',
          label: 'Sprint execution',
          childCollection: {
            id: 'commitments',
            label: 'Commitments',
            items: []
          }
        }
      ],
      { onMoveChild }
    )
    render(<ContextualSidebar navigation={new ContextualSidebarNavigation(root)} />)

    expect(screen.getByRole('button', { name: 'Improve ticket quality' }))
      .toHaveAttribute('aria-roledescription', 'draggable')
    expect(screen.getByRole('button', { name: 'Sprint execution' }))
      .not.toHaveAttribute('aria-roledescription')

    const move = {
      sourceParentItemId: 'overall',
      sourceCollectionId: 'commitments',
      childItemId: 'quality',
      targetParentItemId: 'thread:2',
      targetCollectionId: 'commitments'
    }
    expect(root.canMoveChild(move)).toBe(true)
    root.notifyChildMove(move)
    expect(onMoveChild).toHaveBeenCalledWith(move)
    expect(root.canMoveChild({ ...move, targetParentItemId: 'overall' })).toBe(false)
  })

  it('exposes movable top-level items without making stationary siblings draggable', () => {
    const onMoveItem = vi.fn()
    const root = level(
      'focus:1',
      'Focus',
      [
        { id: 'overall', label: 'Overall' },
        { id: 'thread:2', label: 'Sprint execution', movable: true }
      ],
      {
        itemMoveTargetType: 'focus',
        canMoveItem: ({ itemId, targetId }) =>
          itemId === 'thread:2' && targetId !== '1',
        onMoveItem
      }
    )
    render(<ContextualSidebar navigation={new ContextualSidebarNavigation(root)} />)

    expect(screen.getByRole('button', { name: 'Overall' }))
      .not.toHaveAttribute('aria-roledescription')
    expect(screen.getByRole('button', { name: 'Sprint execution' }))
      .toHaveAttribute('aria-roledescription', 'draggable')
    root.notifyItemMove({ itemId: 'thread:2', targetType: 'focus', targetId: '1' })
    expect(onMoveItem).not.toHaveBeenCalled()
    root.notifyItemMove({ itemId: 'thread:2', targetType: 'focus', targetId: '3' })
    expect(onMoveItem).toHaveBeenCalledWith({
      itemId: 'thread:2',
      targetType: 'focus',
      targetId: '3'
    })
  })

  it('falls back to the selected parent when a nested child is removed', () => {
    const root = level('focus:1', 'Focus', [
      {
        id: 'overall',
        label: 'Overall',
        childCollection: {
          id: 'commitments',
          label: 'Commitments',
          items: [{ id: 'quality', label: 'Improve ticket quality' }]
        }
      }
    ])
    const navigation = new ContextualSidebarNavigation(root)

    navigation.selectChild('overall', 'commitments', 'quality')
    root.setItems([
      {
        id: 'overall',
        label: 'Overall',
        childCollection: {
          id: 'commitments',
          label: 'Commitments',
          items: []
        }
      }
    ])
    navigation.refresh()

    expect(navigation.getSnapshot()).toMatchObject({
      level: root,
      selectedItemId: 'overall',
      selectedChild: null
    })
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
    expect(onThreadSelect).toHaveBeenCalledWith('health')
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

  it('owns descendant paths and leaf selection for atomic deep links', () => {
    const onFocusSectionSelect = vi.fn()
    const onCommitmentSelect = vi.fn()
    const root = level(
      'focus:1',
      'Focus',
      [
        { id: 'overall', label: 'Overall' },
        { id: 'sprint', label: 'Sprint execution' }
      ],
      { onSelect: onFocusSectionSelect }
    )
    const commitments = level(
      'thread:sprint:commitments',
      'Commitments',
      [
        { id: 'quality', label: 'Improve ticket quality' },
        { id: 'review', label: 'Hold weekly refinement' }
      ],
      {
        parent: root,
        parentItemId: 'sprint',
        onSelect: onCommitmentSelect
      }
    )
    const updates = level(
      'commitment:review:updates',
      'Updates',
      [{ id: 'latest', label: 'Latest observation' }],
      { parent: commitments, parentItemId: 'review' }
    )
    const navigation = new ContextualSidebarNavigation(root)

    expect(navigation.getSnapshot().selectedItemId).toBe('overall')
    expect(navigation.navigateToPath(updates, 'latest')).toBe(true)
    expect(navigation.getSnapshot()).toMatchObject({
      level: updates,
      parent: commitments,
      canGoBack: true,
      selectedItemId: 'latest'
    })
    expect(navigation.getSelection(root)).toBe('sprint')
    expect(navigation.getSelection(commitments)).toBe('review')
    expect(onFocusSectionSelect).toHaveBeenCalledWith('sprint')
    expect(onCommitmentSelect).toHaveBeenCalledWith('review')
  })

  it('rejects invalid deep links before changing the active path', () => {
    const root = level('focus:1', 'Focus', [{ id: 'overall', label: 'Overall' }])
    const commitments = level(
      'focus:1:commitments',
      'Commitments',
      [{ id: 'quality', label: 'Improve ticket quality' }],
      { parent: root, parentItemId: 'overall' }
    )
    const unrelatedRoot = level('focus:2', 'Other focus', [
      { id: 'overall', label: 'Overall' }
    ])
    const unrelated = level(
      'focus:2:commitments',
      'Other commitments',
      [{ id: 'other', label: 'Other item' }],
      { parent: unrelatedRoot, parentItemId: 'overall' }
    )
    const navigation = new ContextualSidebarNavigation(root)

    expect(() => navigation.navigateToPath(commitments, 'missing')).toThrow(
      'Cannot deep link to missing item "missing"'
    )
    expect(navigation.getSnapshot()).toMatchObject({ level: root, selectedItemId: 'overall' })
    expect(() => navigation.navigateToPath(unrelated, 'other')).toThrow(
      'does not belong to navigation root "focus:1"'
    )
    expect(navigation.getSnapshot()).toMatchObject({ level: root, selectedItemId: 'overall' })
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

  it('keeps a valid level open when its selected leaf is deleted', () => {
    const root = level('focus:1', 'Focus', [{ id: 'overall', label: 'Overall' }])
    let commitmentsItems: TestItem[] = [
      { id: 'quality', label: 'Improve ticket quality' },
      { id: 'review', label: 'Hold weekly refinement' }
    ]
    const commitments = level('focus:1:commitments', 'Commitments', () => commitmentsItems, {
      parent: root,
      parentItemId: 'overall'
    })
    const navigation = new ContextualSidebarNavigation(root)

    navigation.navigateTo(commitments)
    navigation.select('review')
    commitmentsItems = [{ id: 'quality', label: 'Improve ticket quality' }]
    navigation.refresh()
    expect(navigation.getSnapshot()).toMatchObject({
      level: commitments,
      canGoBack: true,
      selectedItemId: 'quality'
    })

    commitmentsItems = []
    navigation.refresh()
    expect(navigation.getSnapshot()).toMatchObject({
      level: commitments,
      canGoBack: true,
      selectedItemId: null
    })
  })

  it('bubbles to the nearest reachable ancestor when a viewed parent is deleted', () => {
    const root = level('focus:1', 'Focus', [{ id: 'overall', label: 'Overall' }])
    let commitmentsItems: TestItem[] = [
      { id: 'quality', label: 'Improve ticket quality' },
      { id: 'review', label: 'Hold weekly refinement' }
    ]
    const commitments = level('focus:1:commitments', 'Commitments', () => commitmentsItems, {
      parent: root,
      parentItemId: 'overall'
    })
    const updates = level(
      'commitment:quality:updates',
      'Updates',
      [{ id: 'latest', label: 'Latest observation' }],
      { parent: commitments, parentItemId: 'quality' }
    )
    const navigation = new ContextualSidebarNavigation(root)

    navigation.navigateTo(commitments)
    navigation.navigateTo(updates)
    commitmentsItems = [{ id: 'review', label: 'Hold weekly refinement' }]
    navigation.refresh()

    expect(navigation.getSnapshot()).toMatchObject({
      level: commitments,
      parent: root,
      canGoBack: true,
      selectedItemId: 'review'
    })
  })

  it('bubbles through multiple invalid ancestor levels after a deletion cascade', () => {
    let threadItems: TestItem[] = [
      { id: 'sprint', label: 'Sprint execution' },
      { id: 'health', label: 'Team health' }
    ]
    const root = level('focus:1', 'Threads', () => threadItems)
    const commitments = level(
      'thread:sprint:commitments',
      'Commitments',
      [{ id: 'quality', label: 'Improve ticket quality' }],
      { parent: root, parentItemId: 'sprint' }
    )
    const updates = level(
      'commitment:quality:updates',
      'Updates',
      [{ id: 'latest', label: 'Latest observation' }],
      { parent: commitments, parentItemId: 'quality' }
    )
    const navigation = new ContextualSidebarNavigation(root)

    navigation.navigateTo(commitments)
    navigation.navigateTo(updates)
    threadItems = [{ id: 'health', label: 'Team health' }]
    navigation.refresh()

    expect(navigation.getSnapshot()).toMatchObject({
      level: root,
      parent: null,
      canGoBack: false,
      selectedItemId: 'health'
    })
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
