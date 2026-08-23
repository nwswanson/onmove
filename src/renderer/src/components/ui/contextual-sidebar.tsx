import { useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, Layers3, ListChecks, PauseCircle, Plus } from 'lucide-react'
import {
  Sidebar,
  SidebarActionRow,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  type SidebarFooterActionModel
} from '@/components/ui/sidebar'
import {
  StateDot,
  StateLabel,
  type StateLabelModel
} from '@/components/ui/state-label'
import { SemanticSunflower, type SemanticSunflowerModel } from '@/components/ui/sunflower'
import { TaggedText } from '@/components/ui/tagged-text'
import {
  SidebarItemContextMenu,
  type SidebarContextMenuModel
} from '@/components/ui/sidebar-context-menu'
import {
  SidebarDndBoundary,
  type SidebarTransferSourceData,
  type SidebarTransferTargetData
} from '@/components/ui/sidebar-dnd'
import {
  SidebarItemIndicators,
  type SidebarItemIndicator
} from '@/components/ui/sidebar-item-indicators'
import { cn } from '@/lib/utils'
import {
  EntityReference,
  type EntityReferenceModel
} from '@/components/ui/entity-reference'

export interface ContextualSidebarItemGroup {
  id: string
  label: string
}

export interface ContextualSidebarChildItemModel {
  id: string
  label: string
  reference?: EntityReferenceModel
  ariaLabel?: string
  icon?: 'checklist'
  state?: StateLabelModel
  tone?: 'default' | 'muted'
  disabled?: boolean
  movable?: boolean
  activation?: 'selection' | 'action'
  indicators?: readonly SidebarItemIndicator[]
  contextMenu?: SidebarContextMenuModel
}

export interface ContextualSidebarChildCollectionActionModel {
  id: string
  label: string
  ariaLabel?: string
  disabled?: boolean
}

export interface ContextualSidebarChildCollectionModel {
  id: string
  label: string
  emptyState?: string
  items: readonly ContextualSidebarChildItemModel[]
  action?: ContextualSidebarChildCollectionActionModel
  actions?: readonly ContextualSidebarChildCollectionActionModel[]
}

/**
 * Receiver-owned presentation contract for one contextual navigation row.
 * Feature presenters convert domain records into this shape; the sidebar owns
 * all markup, icons, selection styling, focus behavior, and accessibility.
 */
export interface ContextualSidebarItemModel {
  id: string
  label: string
  reference?: EntityReferenceModel
  description?: string
  ariaLabel?: string
  group?: ContextualSidebarItemGroup
  icon?: 'overview' | 'sunflower' | 'paused'
  sunflower?: SemanticSunflowerModel
  accessory?: 'disclosure'
  stateLabel?: StateLabelModel
  tone?: 'default' | 'muted'
  lines?: 1 | 2
  disabled?: boolean
  movable?: boolean
  childCollection?: ContextualSidebarChildCollectionModel
  contextMenu?: SidebarContextMenuModel
  indicators?: readonly SidebarItemIndicator[]
}

export interface ContextualSidebarNewItemAction {
  label: string
  ariaLabel?: string
  disabled?: boolean | (() => boolean)
  onCreate: () => void
}

export interface ContextualSidebarLevelBaseOptions {
  id: string
  title: string
  ariaLabel: string
  parent?: ContextualSidebarLevelBase | null
  parentItemId?: string
  emptyState?: string
  newItem?:
    | ContextualSidebarNewItemAction
    | (() => ContextualSidebarNewItemAction | null)
  footerActions?:
    | readonly SidebarFooterActionModel[]
    | (() => readonly SidebarFooterActionModel[])
  initialSelectedItemId?: string | null
  selectFirstItem?: boolean
}

export interface ContextualSidebarLevelOptions extends ContextualSidebarLevelBaseOptions {
  items:
    | readonly ContextualSidebarItemModel[]
    | (() => readonly ContextualSidebarItemModel[])
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
  onChildContextMenuAction?: (
    parentItemId: string,
    collectionId: string,
    childItemId: string,
    actionId: string,
    checked?: boolean
  ) => void
  onContextMenuAction?: (
    itemId: string,
    actionId: string,
    checked?: boolean
  ) => void
  canMoveChild?: (move: ContextualSidebarChildMove) => boolean
  onMoveChild?: (move: ContextualSidebarChildMove) => void
  itemMoveTargetType?: string
  canMoveItem?: (move: ContextualSidebarItemMove) => boolean
  onMoveItem?: (move: ContextualSidebarItemMove) => void
}

export interface ContextualSidebarChildMove {
  sourceParentItemId: string
  sourceCollectionId: string
  childItemId: string
  targetParentItemId: string
  targetCollectionId: string
}

export interface ContextualSidebarItemMove {
  itemId: string
  targetType: string
  targetId: string
}

/**
 * Type-erased base for a single contextual navigation level. A level owns its
 * items and parent relationship; the navigation controller owns which level
 * is currently visible.
 */
export abstract class ContextualSidebarLevelBase {
  readonly id: string
  readonly title: string
  readonly ariaLabel: string
  readonly parent: ContextualSidebarLevelBase | null
  readonly parentItemId: string | null
  readonly emptyState: string
  readonly initialSelectedItemId: string | null | undefined
  readonly selectFirstItem: boolean
  private readonly resolveNewItem: () => ContextualSidebarNewItemAction | null
  private readonly resolveFooterActions: () => readonly SidebarFooterActionModel[]

  protected constructor({
    id,
    title,
    ariaLabel,
    parent = null,
    parentItemId,
    emptyState = 'No items',
    newItem,
    footerActions,
    initialSelectedItemId,
    selectFirstItem = true
  }: ContextualSidebarLevelBaseOptions) {
    const normalizedId = id.trim()
    const normalizedAriaLabel = ariaLabel.trim()
    if (normalizedId.length === 0) throw new Error('A contextual sidebar level requires an id.')
    if (normalizedAriaLabel.length === 0) {
      throw new Error('A contextual sidebar level requires an accessible label.')
    }
    const normalizedParentItemId = parentItemId?.trim() ?? null
    if (parent && !normalizedParentItemId) {
      throw new Error(
        `Contextual sidebar level "${normalizedId}" must assert an item from its parent level.`
      )
    }
    if (!parent && normalizedParentItemId) {
      throw new Error(
        `Top-level contextual sidebar level "${normalizedId}" cannot assert a parent item.`
      )
    }

    for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.id === normalizedId) {
        throw new Error(`Contextual sidebar level id "${normalizedId}" repeats in its parent path.`)
      }
    }

    this.id = normalizedId
    this.title = title
    this.ariaLabel = normalizedAriaLabel
    this.parent = parent
    this.parentItemId = normalizedParentItemId
    this.emptyState = emptyState
    this.resolveNewItem = typeof newItem === 'function' ? newItem : () => newItem ?? null
    this.resolveFooterActions = typeof footerActions === 'function'
      ? footerActions
      : () => footerActions ?? []
    this.initialSelectedItemId = initialSelectedItemId
    this.selectFirstItem = selectFirstItem
  }

  abstract getItemIds(): readonly string[]
  abstract getItem(itemId: string): ContextualSidebarItemModel | undefined
  abstract hasItem(itemId: string): boolean
  abstract notifySelection(itemId: string): void
  abstract getChildItem(
    parentItemId: string,
    collectionId: string,
    childItemId: string
  ): ContextualSidebarChildItemModel | undefined
  abstract notifyChildSelection(
    parentItemId: string,
    collectionId: string,
    childItemId: string
  ): void
  abstract notifyChildCollectionAction(
    parentItemId: string,
    collectionId: string,
    actionId: string
  ): void
  abstract notifyChildContextMenuAction(
    parentItemId: string,
    collectionId: string,
    childItemId: string,
    actionId: string,
    checked?: boolean
  ): void
  abstract canDragChild(
    parentItemId: string,
    collectionId: string,
    childItemId: string
  ): boolean
  abstract canMoveChild(move: ContextualSidebarChildMove): boolean
  abstract notifyChildMove(move: ContextualSidebarChildMove): void
  abstract canDragItem(itemId: string): boolean
  abstract getItemMoveTargetType(): string | null
  abstract notifyItemMove(move: ContextualSidebarItemMove): void
  abstract notifyContextMenuAction(itemId: string, actionId: string, checked?: boolean): void

  getNewItem(): ContextualSidebarNewItemAction | null {
    const action = this.resolveNewItem()
    if (!action) return null

    const label = action.label.trim()
    if (label.length === 0) {
      throw new Error(`Contextual sidebar level "${this.id}" has a new-item action without a label.`)
    }
    const ariaLabel = action.ariaLabel?.trim() || label
    return { ...action, label, ariaLabel }
  }

  getFooterActions(): readonly SidebarFooterActionModel[] {
    const newItem = this.getNewItem()
    const actions: SidebarFooterActionModel[] = [
      ...(newItem ? [{
        id: '__new-item',
        label: newItem.label,
        ariaLabel: newItem.ariaLabel,
        icon: 'add' as const,
        disabled: newItem.disabled,
        onInvoke: newItem.onCreate
      }] : []),
      ...this.resolveFooterActions()
    ]
    const ids = new Set<string>()
    return actions.map((action) => {
      const id = action.id.trim()
      const label = action.label.trim()
      if (!id || ids.has(id) || !label) {
        throw new Error(
          `Contextual sidebar level "${this.id}" has an invalid footer action "${action.id}".`
        )
      }
      ids.add(id)
      return {
        ...action,
        id,
        label,
        ariaLabel: action.ariaLabel?.trim() || label
      }
    })
  }
}

/**
 * Definition for one sidebar level. It accepts only the sidebar's own item
 * contract, never domain records or caller-provided markup.
 */
export class ContextualSidebarLevel extends ContextualSidebarLevelBase {
  private itemSource: ContextualSidebarLevelOptions['items']
  private readonly onItemSelect?: ContextualSidebarLevelOptions['onSelect']
  private readonly onChildItemSelect?: ContextualSidebarLevelOptions['onSelectChild']
  private readonly onCollectionAction?: ContextualSidebarLevelOptions['onChildCollectionAction']
  private readonly onChildItemContextMenuAction?: ContextualSidebarLevelOptions['onChildContextMenuAction']
  private readonly onItemContextMenuAction?: ContextualSidebarLevelOptions['onContextMenuAction']
  private readonly allowChildMove?: ContextualSidebarLevelOptions['canMoveChild']
  private readonly onChildMove?: ContextualSidebarLevelOptions['onMoveChild']
  private readonly itemMoveTargetType?: string
  private readonly allowItemMove?: ContextualSidebarLevelOptions['canMoveItem']
  private readonly onItemMove?: ContextualSidebarLevelOptions['onMoveItem']

  constructor(options: ContextualSidebarLevelOptions) {
    super(options)
    this.itemSource = options.items
    this.onItemSelect = options.onSelect
    this.onChildItemSelect = options.onSelectChild
    this.onCollectionAction = options.onChildCollectionAction
    this.onChildItemContextMenuAction = options.onChildContextMenuAction
    this.onItemContextMenuAction = options.onContextMenuAction
    this.allowChildMove = options.canMoveChild
    this.onChildMove = options.onMoveChild
    this.itemMoveTargetType = options.itemMoveTargetType?.trim()
    this.allowItemMove = options.canMoveItem
    this.onItemMove = options.onMoveItem
    this.readEntries()
  }

  get items(): readonly ContextualSidebarItemModel[] {
    return typeof this.itemSource === 'function' ? this.itemSource() : this.itemSource
  }

  setItems(items: readonly ContextualSidebarItemModel[]): void {
    this.itemSource = items
    this.readEntries()
  }

  getItem(itemId: string): ContextualSidebarItemModel | undefined {
    return this.readEntries().find((entry) => entry.id === itemId)?.item
  }

  getItemIds(): readonly string[] {
    return this.readEntries().map((entry) => entry.id)
  }

  hasItem(itemId: string): boolean {
    return this.getItem(itemId) !== undefined
  }

  notifySelection(itemId: string): void {
    this.requireItem(itemId)
    this.onItemSelect?.(itemId)
  }

  getChildItem(
    parentItemId: string,
    collectionId: string,
    childItemId: string
  ): ContextualSidebarChildItemModel | undefined {
    const collection = this.requireItem(parentItemId).childCollection
    if (!collection || collection.id !== collectionId) return undefined
    return collection.items.find((item) => item.id === childItemId)
  }

  notifyChildSelection(
    parentItemId: string,
    collectionId: string,
    childItemId: string
  ): void {
    const child = this.getChildItem(parentItemId, collectionId, childItemId)
    if (!child) {
      throw new Error(
        `Contextual sidebar item "${parentItemId}" does not contain child "${childItemId}" in collection "${collectionId}".`
      )
    }
    this.onChildItemSelect?.(parentItemId, collectionId, childItemId)
  }

  notifyChildCollectionAction(
    parentItemId: string,
    collectionId: string,
    actionId: string
  ): void {
    const collection = this.requireItem(parentItemId).childCollection
    if (!collection || collection.id !== collectionId) {
      throw new Error(
        `Contextual sidebar item "${parentItemId}" does not contain collection "${collectionId}".`
      )
    }
    const action = [
      ...(collection.action ? [collection.action] : []),
      ...(collection.actions ?? [])
    ].find(({ id }) => id === actionId)
    if (!action) {
      throw new Error(
        `Contextual sidebar collection "${collectionId}" does not contain action "${actionId}".`
      )
    }
    if (!action.disabled) {
      this.onCollectionAction?.(parentItemId, collectionId, actionId)
    }
  }

  notifyChildContextMenuAction(
    parentItemId: string,
    collectionId: string,
    childItemId: string,
    actionId: string,
    checked?: boolean
  ): void {
    const child = this.getChildItem(parentItemId, collectionId, childItemId)
    if (!child) {
      throw new Error(
        `Contextual sidebar item "${parentItemId}" does not contain child "${childItemId}" in collection "${collectionId}".`
      )
    }
    const action = child.contextMenu?.items.find((candidate) => candidate.id === actionId)
    if (!action || action.disabled || !this.onChildItemContextMenuAction) return
    if (action.kind === 'checkbox' && typeof checked !== 'boolean') return
    this.onChildItemContextMenuAction(
      parentItemId,
      collectionId,
      childItemId,
      actionId,
      checked
    )
  }

  canDragChild(
    parentItemId: string,
    collectionId: string,
    childItemId: string
  ): boolean {
    const child = this.getChildItem(parentItemId, collectionId, childItemId)
    if (!this.onChildMove || !child || child.disabled || child.movable === false) return false
    return this.getItemIds().some((targetParentItemId) => {
      const targetCollection = this.getItem(targetParentItemId)?.childCollection
      return targetCollection && this.canMoveChild({
        sourceParentItemId: parentItemId,
        sourceCollectionId: collectionId,
        childItemId,
        targetParentItemId,
        targetCollectionId: targetCollection.id
      })
    })
  }

  canMoveChild(move: ContextualSidebarChildMove): boolean {
    if (!this.onChildMove || move.sourceParentItemId === move.targetParentItemId) return false
    const child = this.getChildItem(
      move.sourceParentItemId,
      move.sourceCollectionId,
      move.childItemId
    )
    const target = this.getItem(move.targetParentItemId)
    if (
      !child ||
      child.disabled ||
      child.movable === false ||
      !target ||
      target.disabled ||
      target.childCollection?.id !== move.targetCollectionId ||
      move.sourceCollectionId !== move.targetCollectionId
    ) return false
    return this.allowChildMove?.(move) ?? true
  }

  notifyChildMove(move: ContextualSidebarChildMove): void {
    if (!this.canMoveChild(move)) return
    this.onChildMove?.(move)
  }

  canDragItem(itemId: string): boolean {
    return Boolean(
      this.getItem(itemId)?.movable &&
      this.itemMoveTargetType &&
      this.allowItemMove &&
      this.onItemMove
    )
  }

  getItemMoveTargetType(): string | null {
    return this.itemMoveTargetType ?? null
  }

  notifyItemMove(move: ContextualSidebarItemMove): void {
    this.requireItem(move.itemId)
    if (
      !this.canDragItem(move.itemId) ||
      move.targetType !== this.itemMoveTargetType ||
      !this.allowItemMove?.(move)
    ) return
    this.onItemMove?.(move)
  }

  notifyContextMenuAction(itemId: string, actionId: string, checked?: boolean): void {
    const item = this.requireItem(itemId)
    const action = item.contextMenu?.items.find((candidate) => candidate.id === actionId)
    if (!action || action.disabled || !this.onItemContextMenuAction) return
    if (action.kind === 'checkbox' && typeof checked !== 'boolean') return
    this.onItemContextMenuAction(itemId, actionId, checked)
  }

  private readEntries(): Array<{ id: string; item: ContextualSidebarItemModel }> {
    const ids = new Set<string>()
    return this.items.map((item) => {
      const id = item.id.trim()
      if (id.length === 0) {
        throw new Error(`Contextual sidebar level "${this.id}" contains an item without an id.`)
      }
      if (item.label.trim().length === 0) {
        throw new Error(
          `Contextual sidebar level "${this.id}" contains item "${id}" without a label.`
        )
      }
      if (item.description !== undefined && item.description.trim().length === 0) {
        throw new Error(
          `Contextual sidebar level "${this.id}" contains item "${id}" with an empty description.`
        )
      }
      if ((item.icon === 'sunflower') !== (item.sunflower !== undefined)) {
        throw new Error(
          `Contextual sidebar level "${this.id}" contains item "${id}" with an invalid Sunflower model.`
        )
      }
      if (ids.has(id)) {
        throw new Error(`Contextual sidebar level "${this.id}" contains duplicate item id "${id}".`)
      }
      if (item.group && item.group.id.trim().length === 0) {
        throw new Error(`Contextual sidebar level "${this.id}" contains an item group without an id.`)
      }
      if (item.group && item.group.label.trim().length === 0) {
        throw new Error(
          `Contextual sidebar level "${this.id}" contains item group "${item.group.id}" without a label.`
        )
      }
      if (item.childCollection) {
        const collection = item.childCollection
        if (!collection.id.trim() || !collection.label.trim()) {
          throw new Error(
            `Contextual sidebar level "${this.id}" contains item "${id}" with an invalid child collection.`
          )
        }
        const actions = [
          ...(collection.action ? [collection.action] : []),
          ...(collection.actions ?? [])
        ]
        const actionIds = new Set<string>()
        for (const action of actions) {
          if (!action.id.trim() || !action.label.trim() || actionIds.has(action.id)) {
            throw new Error(
              `Contextual sidebar item "${id}" contains an invalid child collection action.`
            )
          }
          actionIds.add(action.id)
        }
        const childIds = new Set<string>()
        for (const child of collection.items) {
          if (!child.id.trim() || !child.label.trim() || childIds.has(child.id)) {
            throw new Error(
              `Contextual sidebar item "${id}" contains an invalid child "${child.id}".`
            )
          }
          childIds.add(child.id)
        }
      }
      ids.add(id)
      return { id, item }
    })
  }

  private requireItem(itemId: string): ContextualSidebarItemModel {
    const item = this.getItem(itemId)
    if (item === undefined) {
      throw new Error(`Contextual sidebar level "${this.id}" does not contain item "${itemId}".`)
    }
    return item
  }
}

export interface ContextualSidebarNavigationSnapshot {
  level: ContextualSidebarLevelBase
  parent: ContextualSidebarLevelBase | null
  canGoBack: boolean
  selectedItemId: string | null
  selectedChild: ContextualSidebarChildSelection | null
}

export interface ContextualSidebarChildSelection {
  parentItemId: string
  collectionId: string
  childItemId: string
}

/**
 * Small external store for progressive contextual navigation. Selections are
 * retained per level so returning to a parent restores its prior selection.
 */
export class ContextualSidebarNavigation {
  private rootLevel: ContextualSidebarLevelBase

  private currentLevel: ContextualSidebarLevelBase
  private readonly selections = new Map<ContextualSidebarLevelBase, string | null>()
  private readonly childSelections = new Map<
    ContextualSidebarLevelBase,
    ContextualSidebarChildSelection
  >()
  private readonly listeners = new Set<() => void>()
  private snapshot: ContextualSidebarNavigationSnapshot

  constructor(root: ContextualSidebarLevelBase) {
    if (root.parent) {
      throw new Error('Contextual sidebar navigation must start with a top-level parentless level.')
    }
    this.rootLevel = root
    this.currentLevel = root
    this.snapshot = this.createSnapshot()
  }

  getSnapshot = (): ContextualSidebarNavigationSnapshot => this.snapshot

  get root(): ContextualSidebarLevelBase {
    return this.rootLevel
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Replaces the complete contextual projection with another parentless root.
   * Primary destinations use this when the same workspace needs a different
   * sidebar lens; unlike entering a child level, the replacement has no Back.
   */
  replaceRoot(root: ContextualSidebarLevelBase, selectedItemId?: string): boolean {
    if (root.parent) {
      throw new Error('A contextual sidebar root projection must be parentless.')
    }
    if (selectedItemId !== undefined) {
      if (!root.hasItem(selectedItemId)) {
        throw new Error(
          `Cannot select missing item "${selectedItemId}" in contextual sidebar root "${root.id}".`
        )
      }
      if (root.getItem(selectedItemId)?.disabled) return false
    }

    this.rootLevel = root
    this.currentLevel = root
    this.childSelections.delete(root)
    if (selectedItemId !== undefined) {
      this.selections.set(root, selectedItemId)
      root.notifySelection(selectedItemId)
    }
    this.publish()
    return true
  }

  navigateTo(level: ContextualSidebarLevelBase): void {
    if (level.parent !== this.currentLevel) {
      throw new Error(
        `Contextual sidebar level "${level.id}" must assert the current level "${this.currentLevel.id}" as its parent.`
      )
    }
    if (level.parentItemId !== this.snapshot.selectedItemId) {
      throw new Error(
        `Contextual sidebar level "${level.id}" asserts parent item "${level.parentItemId}", but "${this.snapshot.selectedItemId}" is selected.`
      )
    }
    this.childSelections.delete(this.currentLevel)
    this.currentLevel = level
    this.publish()
  }

  /**
   * Opens any descendant level as one atomic deep link. The asserted parent
   * path and optional leaf selection are resolved by the navigation owner, so
   * callers never have to coordinate intermediate sidebar selections.
   */
  navigateToPath(
    level: ContextualSidebarLevelBase,
    selectedItemId?: string
  ): boolean {
    const path: ContextualSidebarLevelBase[] = []
    for (let candidate: ContextualSidebarLevelBase | null = level; candidate; candidate = candidate.parent) {
      path.unshift(candidate)
    }
    if (path[0] !== this.rootLevel) {
      throw new Error(
        `Contextual sidebar level "${level.id}" does not belong to navigation root "${this.rootLevel.id}".`
      )
    }

    const assertedSelections = path.slice(1).map((child) => {
      const parent = child.parent
      const parentItemId = child.parentItemId
      if (!parent || !parentItemId || !parent.hasItem(parentItemId)) {
        throw new Error(
          `Contextual sidebar level "${child.id}" asserts missing parent item "${parentItemId ?? ''}".`
        )
      }
      return { level: parent, itemId: parentItemId }
    })
    if (assertedSelections.some(({ level: parent, itemId }) => parent.getItem(itemId)?.disabled)) {
      return false
    }

    if (selectedItemId !== undefined) {
      if (!level.hasItem(selectedItemId)) {
        throw new Error(
          `Cannot deep link to missing item "${selectedItemId}" in contextual sidebar level "${level.id}".`
        )
      }
      if (level.getItem(selectedItemId)?.disabled) return false
    }

    for (const asserted of assertedSelections) {
      this.childSelections.delete(asserted.level)
      if (this.selections.get(asserted.level) === asserted.itemId) continue
      this.selections.set(asserted.level, asserted.itemId)
      asserted.level.notifySelection(asserted.itemId)
    }
    if (
      selectedItemId !== undefined &&
      this.selections.get(level) !== selectedItemId
    ) {
      this.selections.set(level, selectedItemId)
      this.childSelections.delete(level)
      level.notifySelection(selectedItemId)
    }
    this.currentLevel = level
    this.publish()
    return true
  }

  back(): boolean {
    const parent = this.currentLevel.parent
    if (!parent) return false
    this.childSelections.delete(parent)
    this.currentLevel = parent
    this.publish()
    return true
  }

  reset(): void {
    this.childSelections.delete(this.rootLevel)
    if (this.currentLevel === this.rootLevel) {
      this.publish()
      return
    }
    this.currentLevel = this.rootLevel
    this.publish()
  }

  select(itemId: string): boolean {
    if (!this.currentLevel.hasItem(itemId)) {
      throw new Error(
        `Cannot select missing item "${itemId}" in contextual sidebar level "${this.currentLevel.id}".`
      )
    }
    if (this.currentLevel.getItem(itemId)?.disabled) return false
    this.selections.set(this.currentLevel, itemId)
    this.childSelections.delete(this.currentLevel)
    this.currentLevel.notifySelection(itemId)
    this.publish()
    return true
  }

  /** Select a nested route without replacing the currently visible sidebar level. */
  selectChild(
    parentItemId: string,
    collectionId: string,
    childItemId: string
  ): boolean {
    const parent = this.currentLevel.getItem(parentItemId)
    const child = this.currentLevel.getChildItem(
      parentItemId,
      collectionId,
      childItemId
    )
    if (!parent || !child) {
      throw new Error(
        `Cannot select missing child "${childItemId}" from contextual sidebar item "${parentItemId}".`
      )
    }
    if (parent.disabled || child.disabled) return false

    this.selections.set(this.currentLevel, parentItemId)
    this.currentLevel.notifySelection(parentItemId)
    this.childSelections.set(this.currentLevel, {
      parentItemId,
      collectionId,
      childItemId
    })
    this.currentLevel.notifyChildSelection(
      parentItemId,
      collectionId,
      childItemId
    )
    this.publish()
    return true
  }

  getSelection(level: ContextualSidebarLevelBase): string | null {
    return this.resolveSelection(level)
  }

  getChildSelection(
    level: ContextualSidebarLevelBase
  ): ContextualSidebarChildSelection | null {
    return this.resolveChildSelection(level)
  }

  /** Reconciles selections after a level's item provider changes. */
  refresh(): void {
    this.currentLevel = this.resolveReachableLevel(this.currentLevel)
    this.snapshot = this.createSnapshot()
    this.emit()
  }

  private resolveReachableLevel(
    level: ContextualSidebarLevelBase
  ): ContextualSidebarLevelBase {
    let reachable = level
    for (let descendant = level; descendant.parent; descendant = descendant.parent) {
      const parent = descendant.parent
      const parentItemId = descendant.parentItemId
      if (!parentItemId || !parent.hasItem(parentItemId)) reachable = parent
    }
    return reachable
  }

  private createSnapshot(): ContextualSidebarNavigationSnapshot {
    return {
      level: this.currentLevel,
      parent: this.currentLevel.parent,
      canGoBack: this.currentLevel.parent !== null,
      selectedItemId: this.resolveSelection(this.currentLevel),
      selectedChild: this.resolveChildSelection(this.currentLevel)
    }
  }

  private resolveChildSelection(
    level: ContextualSidebarLevelBase
  ): ContextualSidebarChildSelection | null {
    const current = this.childSelections.get(level)
    if (
      current &&
      this.resolveSelection(level) === current.parentItemId &&
      level.getChildItem(
        current.parentItemId,
        current.collectionId,
        current.childItemId
      )
    ) {
      return current
    }
    this.childSelections.delete(level)
    return null
  }

  private resolveSelection(level: ContextualSidebarLevelBase): string | null {
    const itemIds = level.getItemIds()
    const current = this.selections.get(level)
    if (current !== undefined && current !== null && itemIds.includes(current)) return current
    if (current === null && itemIds.length === 0) return null

    const requested = level.initialSelectedItemId
    if (requested !== undefined && requested !== null) {
      if (!itemIds.includes(requested)) {
        throw new Error(
          `Initial item "${requested}" is missing from contextual sidebar level "${level.id}".`
        )
      }
      this.selections.set(level, requested)
      return requested
    }

    const fallback = level.selectFirstItem ? (itemIds[0] ?? null) : null
    this.selections.set(level, fallback)
    return fallback
  }

  private publish(): void {
    this.snapshot = this.createSnapshot()
    this.emit()
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}

export interface ContextualSidebarProps extends Omit<ComponentProps<'aside'>, 'title'> {
  navigation: ContextualSidebarNavigation
}

function contextualParentTargetType(levelId: string): string {
  return `contextual-parent:${levelId}`
}

function contextualParentTargetId(parentItemId: string, collectionId: string): string {
  return JSON.stringify([parentItemId, collectionId])
}

function parseContextualParentTargetId(value: string): [string, string] | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.length === 2 &&
      parsed.every((part) => typeof part === 'string')
      ? [parsed[0], parsed[1]]
      : null
  } catch {
    return null
  }
}

function ContextualSidebarDropItem({
  levelId,
  itemId,
  collectionId,
  disabled,
  children
}: {
  levelId: string
  itemId: string
  collectionId: string
  disabled: boolean
  children: ReactNode
}): React.JSX.Element {
  const { isOver, setNodeRef } = useDroppable({
    id: `contextual-drop:${levelId}:${itemId}:${collectionId}`,
    disabled,
    data: {
      kind: 'sidebar-transfer-target',
      targetType: contextualParentTargetType(levelId),
      targetId: contextualParentTargetId(itemId, collectionId)
    } satisfies SidebarTransferTargetData
  })
  return (
    <SidebarMenuItem
      ref={setNodeRef}
      data-drop-target={isOver ? 'active' : 'inactive'}
      className={cn(isOver && 'rounded-lg ring-2 ring-primary/55')}
    >
      {children}
    </SidebarMenuItem>
  )
}

function ContextualSidebarDraggableChild({
  level,
  navigation,
  parentItemId,
  collection,
  child,
  selected
}: {
  level: ContextualSidebarLevelBase
  navigation: ContextualSidebarNavigation
  parentItemId: string
  collection: ContextualSidebarChildCollectionModel
  child: ContextualSidebarChildItemModel
  selected: boolean
}): React.JSX.Element {
  const draggable = level.canDragChild(parentItemId, collection.id, child.id)
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: `contextual-child:${level.id}:${parentItemId}:${collection.id}:${child.id}`,
    disabled: !draggable,
    data: {
      kind: 'sidebar-transfer-source',
      sourceId: child.id,
      acceptedTargetType: contextualParentTargetType(level.id),
      preview: { label: child.label, ...(child.state ? { state: child.state } : {}) },
      onDrop: (target) => {
        const destination = parseContextualParentTargetId(target.targetId)
        if (!destination) return
        level.notifyChildMove({
          sourceParentItemId: parentItemId,
          sourceCollectionId: collection.id,
          childItemId: child.id,
          targetParentItemId: destination[0],
          targetCollectionId: destination[1]
        })
      }
    } satisfies SidebarTransferSourceData
  })

  return (
    <li ref={setNodeRef} data-dragging={isDragging ? 'true' : 'false'}>
      <SidebarItemContextMenu
        model={child.contextMenu}
        onAction={(actionId, checked) => level.notifyChildContextMenuAction(
          parentItemId,
          collection.id,
          child.id,
          actionId,
          checked
        )}
      >
        <button
          type="button"
          {...(draggable ? attributes : {})}
          {...(draggable ? listeners : {})}
          aria-current={selected ? 'page' : undefined}
          aria-label={child.ariaLabel ?? child.label}
          disabled={child.disabled}
          className={cn(
            'flex min-h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/55 disabled:pointer-events-none disabled:opacity-50',
            draggable && 'touch-none',
            selected && 'bg-sidebar-accent text-sidebar-accent-foreground',
            child.tone === 'muted' && 'text-muted-foreground opacity-55',
            isDragging && 'opacity-35'
          )}
          onClick={() => child.activation === 'action'
            ? level.notifyChildSelection(parentItemId, collection.id, child.id)
            : navigation.selectChild(parentItemId, collection.id, child.id)}
        >
          {child.icon === 'checklist' && (
            <ListChecks className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          {child.state && <StateDot model={child.state} />}
          <span className="min-w-0 flex-1 truncate"><TaggedText value={child.label} /></span>
          {child.reference && <EntityReference {...child.reference} className="h-4 px-1 text-[0.5625rem]" />}
          <SidebarItemIndicators indicators={child.indicators} size="compact" />
        </button>
      </SidebarItemContextMenu>
    </li>
  )
}

function ContextualSidebarItemButton({
  level,
  navigation,
  item,
  selected,
  selectedChildBelongsToItem
}: {
  level: ContextualSidebarLevelBase
  navigation: ContextualSidebarNavigation
  item: ContextualSidebarItemModel
  selected: boolean
  selectedChildBelongsToItem: boolean
}): React.JSX.Element {
  const draggable = level.canDragItem(item.id)
  const targetType = level.getItemMoveTargetType()
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: `contextual-item:${level.id}:${item.id}`,
    disabled: !draggable || !targetType,
    data: targetType ? {
      kind: 'sidebar-transfer-source',
      sourceId: item.id,
      acceptedTargetType: targetType,
      preview: { label: item.label },
      onDrop: (target) => level.notifyItemMove({
        itemId: item.id,
        targetType: target.targetType,
        targetId: target.targetId
      })
    } satisfies SidebarTransferSourceData : undefined
  })

  return (
    <SidebarItemContextMenu
      model={item.contextMenu}
      onAction={(actionId, checked) =>
        level.notifyContextMenuAction(item.id, actionId, checked)}
    >
      <SidebarMenuButton
        ref={setNodeRef}
        type="button"
        {...(draggable ? attributes : {})}
        {...(draggable ? listeners : {})}
        isActive={selected}
        aria-current={selected && !selectedChildBelongsToItem ? 'page' : undefined}
        aria-label={item.ariaLabel ?? item.label}
        title={item.sunflower?.ariaLabel}
        disabled={item.disabled}
        data-dragging={isDragging ? 'true' : 'false'}
        className={cn(
          item.tone === 'muted' && 'text-muted-foreground opacity-55',
          item.lines === 2 && 'h-auto min-h-9 py-2',
          draggable && 'touch-none',
          isDragging && 'opacity-35'
        )}
        onClick={() => navigation.select(item.id)}
      >
        {item.icon === 'overview' ? (
          <Layers3 aria-hidden="true" />
        ) : item.icon === 'paused' ? (
          <PauseCircle aria-hidden="true" />
        ) : item.icon === 'sunflower' && item.sunflower ? (
          <SemanticSunflower className="!size-6" model={item.sunflower} />
        ) : null}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block',
              item.description
                ? 'truncate'
                : item.lines === 2
                  ? 'line-clamp-2'
                  : 'truncate'
            )}
          >
            <TaggedText value={item.label} />
          </span>
          {item.description && (
            <span className="mt-0.5 block truncate text-[0.6875rem] text-muted-foreground">
              {item.description}
            </span>
          )}
        </span>
        {item.reference && <EntityReference {...item.reference} />}
        <SidebarItemIndicators indicators={item.indicators} />
        {item.stateLabel && <StateLabel model={item.stateLabel} size="compact" />}
        {item.accessory === 'disclosure' && (
          <ChevronRight className="ml-auto" aria-hidden="true" />
        )}
      </SidebarMenuButton>
    </SidebarItemContextMenu>
  )
}

/** Subscribe main views or other consumers to the same canonical selection. */
export function useContextualSidebarNavigation(
  navigation: ContextualSidebarNavigation
): ContextualSidebarNavigationSnapshot {
  return useSyncExternalStore(
    navigation.subscribe,
    navigation.getSnapshot,
    navigation.getSnapshot
  )
}

export function ContextualSidebar({
  ...props
}: ContextualSidebarProps): React.JSX.Element {
  return (
    <SidebarDndBoundary>
      <ContextualSidebarContent {...props} />
    </SidebarDndBoundary>
  )
}

function ContextualSidebarContent({
  navigation,
  className,
  ...props
}: ContextualSidebarProps): React.JSX.Element {
  const snapshot = useContextualSidebarNavigation(navigation)
  const { level, parent, selectedItemId, selectedChild } = snapshot
  const itemIds = level.getItemIds()
  const groups = itemIds.reduce<Array<{ group: ContextualSidebarItemGroup | null; itemIds: string[] }>>(
    (result, itemId) => {
      const group = level.getItem(itemId)?.group ?? null
      const previous = result.at(-1)
      if (previous && previous.group?.id === group?.id) {
        previous.itemIds.push(itemId)
      } else {
        result.push({ group, itemIds: [itemId] })
      }
      return result
    },
    []
  )
  const footerActions = level.getFooterActions()
  const dragEnabled = itemIds.some((itemId) => {
    const collection = level.getItem(itemId)?.childCollection
    return collection?.items.some((child) =>
      level.canDragChild(itemId, collection.id, child.id)
    ) ?? false
  })
  return (
    <Sidebar
      data-slot="contextual-sidebar"
      data-level-id={level.id}
      aria-label="Contextual sidebar"
      className={cn('w-64 bg-muted/28', className)}
      {...props}
    >
      <SidebarHeader className="min-h-13 justify-center border-b border-sidebar-border px-2 py-2">
        {parent ? (
          <SidebarMenuButton
            type="button"
            aria-label={`Back to ${parent.ariaLabel}`}
            onClick={() => navigation.back()}
          >
            <ChevronLeft aria-hidden="true" />
            <span>Back</span>
          </SidebarMenuButton>
        ) : (
          <p className="truncate px-2 text-xs font-semibold tracking-tight">{level.title}</p>
        )}
      </SidebarHeader>

      <SidebarContent className="p-2">
        <nav aria-label={level.ariaLabel}>
          {parent && groups.every(({ group }) => !group) && (
            <SidebarGroupLabel>{level.title}</SidebarGroupLabel>
          )}
          {groups.map(({ group, itemIds: groupItemIds }, groupIndex) => (
            <SidebarGroup key={group?.id ?? `ungrouped-${groupIndex}`} className="mb-3 last:mb-0">
              {group && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
              <SidebarMenu>
                {groupItemIds.map((itemId) => {
                  const selected = itemId === selectedItemId
                  const item = level.getItem(itemId)
                  if (!item) return null
                  const childCollection = item.childCollection
                  const childCollectionActions = childCollection
                    ? [
                        ...(childCollection.action ? [childCollection.action] : []),
                        ...(childCollection.actions ?? [])
                      ]
                    : []
                  const selectedChildBelongsToItem =
                    selectedChild?.parentItemId === itemId
                  return (
                    <ContextualSidebarDropItem
                      key={itemId}
                      levelId={level.id}
                      itemId={itemId}
                      collectionId={childCollection?.id ?? 'none'}
                      disabled={!dragEnabled || !childCollection}
                    >
                      <ContextualSidebarItemButton
                        level={level}
                        navigation={navigation}
                        item={item}
                        selected={selected}
                        selectedChildBelongsToItem={selectedChildBelongsToItem}
                      />
                      {childCollection && (
                        childCollectionActions.length > 0 || childCollection.items.length > 0
                      ) && (
                        <div
                          className="ml-4 border-l border-sidebar-border/80 pl-2"
                          data-child-collection-id={childCollection.id}
                        >
                          {childCollectionActions.map((action) => (
                            <button
                              key={action.id}
                              type="button"
                              className="flex min-h-7 w-full items-center gap-1 rounded-md px-2 text-left text-[0.6875rem] font-semibold text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/55 disabled:pointer-events-none disabled:opacity-50"
                              aria-label={
                                action.ariaLabel ?? action.label
                              }
                              disabled={action.disabled}
                              onClick={() =>
                                level.notifyChildCollectionAction(
                                  itemId,
                                  childCollection.id,
                                  action.id
                                )
                              }
                            >
                              <Plus className="size-3.5" aria-hidden="true" />
                              <span className="truncate">
                                {action.label}
                              </span>
                            </button>
                          ))}
                          <ul
                            role="list"
                            aria-label={`${item.label} ${childCollection.label}`}
                            className="pb-1"
                          >
                            {childCollection.items.map((child) => {
                              const childSelected =
                                selectedChildBelongsToItem &&
                                selectedChild.collectionId === childCollection.id &&
                                selectedChild.childItemId === child.id
                              return (
                                <ContextualSidebarDraggableChild
                                  key={child.id}
                                  level={level}
                                  navigation={navigation}
                                  parentItemId={itemId}
                                  collection={childCollection}
                                  child={child}
                                  selected={childSelected}
                                />
                              )
                            })}
                            {childCollection.items.length === 0 && (
                              <li className="px-2 py-1 text-[0.6875rem] text-muted-foreground">
                                {childCollection.emptyState ?? 'No items'}
                              </li>
                            )}
                          </ul>
                        </div>
                      )}
                    </ContextualSidebarDropItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
          {itemIds.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">{level.emptyState}</div>
          )}
        </nav>
      </SidebarContent>
      {footerActions.length > 0 && (
        <SidebarFooter className="border-t border-sidebar-border p-2">
          <SidebarMenu>
            <SidebarActionRow
              actions={footerActions}
              className="mt-0 border-t-0 pt-0"
            />
          </SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  )
}
