import {
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode
} from 'react'
import { ChevronLeft, Plus } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export interface ContextualSidebarItemRenderState {
  itemId: string
  selected: boolean
}

export interface ContextualSidebarItemGroup {
  id: string
  label: ReactNode
}

export interface ContextualSidebarNewItemAction {
  label: string
  ariaLabel?: string
  disabled?: boolean | (() => boolean)
  onCreate: () => void
}

export interface ContextualSidebarLevelBaseOptions {
  id: string
  title: ReactNode
  ariaLabel: string
  parent?: ContextualSidebarLevelBase | null
  parentItemId?: string
  emptyState?: ReactNode
  newItem?:
    | ContextualSidebarNewItemAction
    | (() => ContextualSidebarNewItemAction | null)
  footer?: ReactNode | (() => ReactNode)
  initialSelectedItemId?: string | null
  selectFirstItem?: boolean
}

export interface ContextualSidebarLevelOptions<TItem>
  extends ContextualSidebarLevelBaseOptions {
  items: readonly TItem[] | (() => readonly TItem[])
  getItemId: (item: TItem) => string
  renderItem: (item: TItem, state: ContextualSidebarItemRenderState) => ReactNode
  getItemAriaLabel?: (item: TItem) => string
  getItemGroup?: (item: TItem) => ContextualSidebarItemGroup | null
  getItemClassName?: (item: TItem, state: ContextualSidebarItemRenderState) => string | undefined
  isItemDisabled?: (item: TItem) => boolean
  onSelect?: (item: TItem) => void
}

/**
 * Type-erased base for a single contextual navigation level. A level owns its
 * items and parent relationship; the navigation controller owns which level
 * is currently visible.
 */
export abstract class ContextualSidebarLevelBase {
  readonly id: string
  readonly title: ReactNode
  readonly ariaLabel: string
  readonly parent: ContextualSidebarLevelBase | null
  readonly parentItemId: string | null
  readonly emptyState: ReactNode
  readonly initialSelectedItemId: string | null | undefined
  readonly selectFirstItem: boolean
  private readonly resolveNewItem: () => ContextualSidebarNewItemAction | null
  private readonly resolveFooter: () => ReactNode

  protected constructor({
    id,
    title,
    ariaLabel,
    parent = null,
    parentItemId,
    emptyState = 'No items',
    newItem,
    footer = null,
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
    this.resolveFooter = typeof footer === 'function' ? footer : () => footer
    this.initialSelectedItemId = initialSelectedItemId
    this.selectFirstItem = selectFirstItem
  }

  abstract getItemIds(): readonly string[]
  abstract hasItem(itemId: string): boolean
  abstract isItemDisabled(itemId: string): boolean
  abstract getItemAriaLabel(itemId: string): string | undefined
  abstract getItemGroup(itemId: string): ContextualSidebarItemGroup | null
  abstract getItemClassName(itemId: string, selected: boolean): string | undefined
  abstract renderItem(itemId: string, selected: boolean): ReactNode
  abstract notifySelection(itemId: string): void

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

  getFooter(): ReactNode {
    return this.resolveFooter()
  }
}

/**
 * Typed definition for one sidebar level. It may be instantiated directly or
 * subclassed when a domain wants named Focus/Thread/Commitment level classes.
 */
export class ContextualSidebarLevel<TItem> extends ContextualSidebarLevelBase {
  private itemSource: readonly TItem[] | (() => readonly TItem[])
  private readonly resolveItemId: (item: TItem) => string
  private readonly renderItemContent: ContextualSidebarLevelOptions<TItem>['renderItem']
  private readonly resolveItemAriaLabel?: ContextualSidebarLevelOptions<TItem>['getItemAriaLabel']
  private readonly resolveItemGroup?: ContextualSidebarLevelOptions<TItem>['getItemGroup']
  private readonly resolveItemClassName?: ContextualSidebarLevelOptions<TItem>['getItemClassName']
  private readonly resolveItemDisabled?: ContextualSidebarLevelOptions<TItem>['isItemDisabled']
  private readonly onItemSelect?: ContextualSidebarLevelOptions<TItem>['onSelect']

  constructor(options: ContextualSidebarLevelOptions<TItem>) {
    super(options)
    this.itemSource = options.items
    this.resolveItemId = options.getItemId
    this.renderItemContent = options.renderItem
    this.resolveItemAriaLabel = options.getItemAriaLabel
    this.resolveItemGroup = options.getItemGroup
    this.resolveItemClassName = options.getItemClassName
    this.resolveItemDisabled = options.isItemDisabled
    this.onItemSelect = options.onSelect
    this.readEntries()
  }

  get items(): readonly TItem[] {
    return typeof this.itemSource === 'function' ? this.itemSource() : this.itemSource
  }

  setItems(items: readonly TItem[]): void {
    this.itemSource = items
    this.readEntries()
  }

  getItem(itemId: string): TItem | undefined {
    return this.readEntries().find((entry) => entry.id === itemId)?.item
  }

  getItemIds(): readonly string[] {
    return this.readEntries().map((entry) => entry.id)
  }

  hasItem(itemId: string): boolean {
    return this.getItem(itemId) !== undefined
  }

  isItemDisabled(itemId: string): boolean {
    const item = this.requireItem(itemId)
    return this.resolveItemDisabled?.(item) ?? false
  }

  getItemAriaLabel(itemId: string): string | undefined {
    const item = this.requireItem(itemId)
    return this.resolveItemAriaLabel?.(item)
  }

  getItemGroup(itemId: string): ContextualSidebarItemGroup | null {
    const item = this.requireItem(itemId)
    const group = this.resolveItemGroup?.(item) ?? null
    if (!group) return null
    const id = group.id.trim()
    if (id.length === 0) {
      throw new Error(`Contextual sidebar level "${this.id}" contains an item group without an id.`)
    }
    return { ...group, id }
  }

  getItemClassName(itemId: string, selected: boolean): string | undefined {
    const item = this.requireItem(itemId)
    return this.resolveItemClassName?.(item, { itemId, selected })
  }

  renderItem(itemId: string, selected: boolean): ReactNode {
    const item = this.requireItem(itemId)
    return this.renderItemContent(item, { itemId, selected })
  }

  notifySelection(itemId: string): void {
    this.onItemSelect?.(this.requireItem(itemId))
  }

  private readEntries(): Array<{ id: string; item: TItem }> {
    const ids = new Set<string>()
    return this.items.map((item) => {
      const id = this.resolveItemId(item).trim()
      if (id.length === 0) {
        throw new Error(`Contextual sidebar level "${this.id}" contains an item without an id.`)
      }
      if (ids.has(id)) {
        throw new Error(`Contextual sidebar level "${this.id}" contains duplicate item id "${id}".`)
      }
      ids.add(id)
      return { id, item }
    })
  }

  private requireItem(itemId: string): TItem {
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
}

/**
 * Small external store for progressive contextual navigation. Selections are
 * retained per level so returning to a parent restores its prior selection.
 */
export class ContextualSidebarNavigation {
  readonly root: ContextualSidebarLevelBase

  private currentLevel: ContextualSidebarLevelBase
  private readonly selections = new Map<ContextualSidebarLevelBase, string | null>()
  private readonly listeners = new Set<() => void>()
  private snapshot: ContextualSidebarNavigationSnapshot

  constructor(root: ContextualSidebarLevelBase) {
    if (root.parent) {
      throw new Error('Contextual sidebar navigation must start with a top-level parentless level.')
    }
    this.root = root
    this.currentLevel = root
    this.snapshot = this.createSnapshot()
  }

  getSnapshot = (): ContextualSidebarNavigationSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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
    this.currentLevel = level
    this.publish()
  }

  back(): boolean {
    const parent = this.currentLevel.parent
    if (!parent) return false
    this.currentLevel = parent
    this.publish()
    return true
  }

  reset(): void {
    if (this.currentLevel === this.root) return
    this.currentLevel = this.root
    this.publish()
  }

  select(itemId: string): boolean {
    if (!this.currentLevel.hasItem(itemId)) {
      throw new Error(
        `Cannot select missing item "${itemId}" in contextual sidebar level "${this.currentLevel.id}".`
      )
    }
    if (this.currentLevel.isItemDisabled(itemId)) return false
    this.selections.set(this.currentLevel, itemId)
    this.currentLevel.notifySelection(itemId)
    this.publish()
    return true
  }

  getSelection(level: ContextualSidebarLevelBase): string | null {
    return this.resolveSelection(level)
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
      selectedItemId: this.resolveSelection(this.currentLevel)
    }
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
  navigation,
  className,
  ...props
}: ContextualSidebarProps): React.JSX.Element {
  const snapshot = useContextualSidebarNavigation(navigation)
  const { level, parent, selectedItemId } = snapshot
  const itemIds = level.getItemIds()
  const groups = itemIds.reduce<Array<{ group: ContextualSidebarItemGroup | null; itemIds: string[] }>>(
    (result, itemId) => {
      const group = level.getItemGroup(itemId)
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
  const footer = level.getFooter()
  const newItem = level.getNewItem()
  const newItemDisabled =
    typeof newItem?.disabled === 'function' ? newItem.disabled() : newItem?.disabled

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
                  return (
                    <SidebarMenuItem key={itemId}>
                      <SidebarMenuButton
                        type="button"
                        isActive={selected}
                        aria-current={selected ? 'page' : undefined}
                        aria-label={level.getItemAriaLabel(itemId)}
                        disabled={level.isItemDisabled(itemId)}
                        className={level.getItemClassName(itemId, selected)}
                        onClick={() => navigation.select(itemId)}
                      >
                        {level.renderItem(itemId, selected)}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
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
      {(footer || newItem) && (
        <SidebarFooter className="border-t border-sidebar-border p-2">
          {footer}
          {newItem && (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  aria-label={newItem.ariaLabel}
                  disabled={newItemDisabled}
                  className="text-sidebar-foreground/72"
                  onClick={newItem.onCreate}
                >
                  <Plus aria-hidden="true" />
                  <span className="truncate">{newItem.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarFooter>
      )}
    </Sidebar>
  )
}
