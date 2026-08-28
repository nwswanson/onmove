import {
  Archive,
  CalendarClock,
  ClipboardCheck,
  LayoutDashboard,
  ListChecks,
  PauseCircle,
  Repeat2,
  Tags
} from 'lucide-react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import {
  SidebarActionRow,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  type SidebarFooterActionModel
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { SemanticSunflower, type SemanticSunflowerModel } from '@/components/ui/sunflower'
import { TaggedText } from '@/components/ui/tagged-text'
import {
  SidebarItemContextMenu,
  type SidebarContextMenuModel
} from '@/components/ui/sidebar-context-menu'
import {
  SidebarDndBoundary,
  type SidebarTransferSourceData,
  type SidebarTransferTarget,
  type SidebarTransferTargetData
} from '@/components/ui/sidebar-dnd'
import {
  SidebarFolderRootTarget,
  SidebarFolderSection,
  type SidebarFolderModel,
  validateSidebarFolders
} from '@/components/ui/sidebar-folder'
import {
  SidebarItemIndicators,
  type SidebarItemIndicator
} from '@/components/ui/sidebar-item-indicators'

/** Receiver-owned row contract for primary sidebar navigation. */
export interface SidebarNavigationItemModel {
  id: string
  label: string
  ariaLabel?: string
  icon?: 'todos' | 'tags' | 'review' | 'routines' | 'due' | 'canvas' | 'archive' | 'sunflower' | 'paused'
  sunflower?: SemanticSunflowerModel
  tone?: 'default' | 'muted'
  disabled?: boolean
  dropTarget?: { type: string; id: string }
  transfer?: {
    acceptedTargetTypes: readonly string[]
    onDrop: (target: SidebarTransferTarget) => void
  }
  badge?: {
    value: number
    label: string
  }
  indicators?: readonly SidebarItemIndicator[]
  contextMenu?: SidebarContextMenuModel
}

export type SidebarNavigationActionModel = SidebarFooterActionModel

export interface SidebarNavigationProps {
  items: readonly SidebarNavigationItemModel[]
  selectedItemId: string | null
  emptyLabel?: string
  actions?: readonly SidebarNavigationActionModel[]
  folders?: readonly SidebarFolderModel[]
  folderRootDropTarget?: { type: string; id: string }
  onSelect: (itemId: string) => void
  onContextMenuAction?: (itemId: string, actionId: string, checked?: boolean) => void
  onFolderContextMenuAction?: (
    folderId: string,
    actionId: string,
    checked?: boolean
  ) => void
}

/** Owns primary-navigation row markup, interaction, focus, and selection semantics. */
export function SidebarNavigation({
  ...props
}: SidebarNavigationProps): React.JSX.Element {
  return (
    <SidebarDndBoundary>
      <SidebarNavigationContent {...props} />
    </SidebarDndBoundary>
  )
}

function SidebarNavigationRow({
  item,
  selected,
  onSelect,
  onContextMenuAction
}: {
  item: SidebarNavigationItemModel
  selected: boolean
  onSelect: (itemId: string) => void
  onContextMenuAction?: SidebarNavigationProps['onContextMenuAction']
}): React.JSX.Element {
  const draggable = Boolean(item.transfer && !item.disabled)
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef: setDraggableNodeRef
  } = useDraggable({
    id: `primary-navigation-source:${item.id}`,
    disabled: !draggable,
    data: item.transfer ? {
      kind: 'sidebar-transfer-source',
      sourceId: item.id,
      acceptedTargetTypes: item.transfer.acceptedTargetTypes,
      preview: { label: item.label },
      onDrop: item.transfer.onDrop
    } satisfies SidebarTransferSourceData : undefined
  })
  const { isOver, setNodeRef } = useDroppable({
    id: `primary-navigation-target:${item.dropTarget?.type ?? 'none'}:${item.id}`,
    disabled: !item.dropTarget || item.disabled,
    data: item.dropTarget ? {
      kind: 'sidebar-transfer-target',
      targetType: item.dropTarget.type,
      targetId: item.dropTarget.id
    } satisfies SidebarTransferTargetData : undefined
  })

  return (
    <SidebarMenuItem
      ref={setNodeRef}
      data-drop-target={isOver ? 'active' : 'inactive'}
      className={cn(isOver && 'rounded-lg ring-2 ring-primary/55')}
    >
      <SidebarItemContextMenu
        model={item.contextMenu}
        onAction={(actionId, checked) =>
          onContextMenuAction?.(item.id, actionId, checked)}
      >
        <SidebarMenuButton
          ref={setDraggableNodeRef}
          type="button"
          {...(draggable ? attributes : {})}
          {...(draggable ? listeners : {})}
          isActive={selected}
          aria-current={selected ? 'page' : undefined}
          aria-label={`${item.ariaLabel ?? item.label}${
            item.badge ? `, ${item.badge.label}` : ''
          }`}
          title={item.sunflower?.ariaLabel}
          className={cn(
            item.tone === 'muted' && 'text-muted-foreground opacity-55',
            draggable && 'touch-none',
            isDragging && 'opacity-35'
          )}
          disabled={item.disabled}
          onClick={() => onSelect(item.id)}
        >
          {item.icon === 'todos' ? (
            <ListChecks aria-hidden="true" />
          ) : item.icon === 'tags' ? (
            <Tags aria-hidden="true" />
          ) : item.icon === 'review' ? (
            <ClipboardCheck aria-hidden="true" />
          ) : item.icon === 'routines' ? (
            <Repeat2 aria-hidden="true" />
          ) : item.icon === 'due' ? (
            <CalendarClock aria-hidden="true" />
          ) : item.icon === 'canvas' ? (
            <LayoutDashboard aria-hidden="true" />
          ) : item.icon === 'archive' ? (
            <Archive aria-hidden="true" />
          ) : item.icon === 'paused' ? (
            <PauseCircle aria-hidden="true" />
          ) : item.icon === 'sunflower' && item.sunflower ? (
            <SemanticSunflower className="!size-6" model={item.sunflower} />
          ) : null}
          <span className="min-w-0 flex-1 truncate"><TaggedText value={item.label} /></span>
          <SidebarItemIndicators indicators={item.indicators} />
          {item.badge && (
            <span
              aria-hidden="true"
              className="min-w-5 shrink-0 rounded-full bg-sidebar-accent px-1.5 py-0.5 text-center text-[0.6875rem] font-semibold tabular-nums text-sidebar-accent-foreground group-data-[active=true]/menu-button:bg-primary/45"
            >
              {item.badge.value}
            </span>
          )}
        </SidebarMenuButton>
      </SidebarItemContextMenu>
    </SidebarMenuItem>
  )
}

function SidebarNavigationContent({
  items,
  selectedItemId,
  emptyLabel = 'No items',
  actions = [],
  folders = [],
  folderRootDropTarget,
  onSelect,
  onContextMenuAction,
  onFolderContextMenuAction
}: SidebarNavigationProps): React.JSX.Element {
  const itemIds = new Set<string>()
  for (const item of items) {
    const id = item.id.trim()
    if (!id || itemIds.has(id) || item.label.trim().length === 0) {
      throw new Error(`Primary sidebar contains an invalid navigation item "${item.id}".`)
    }
    if ((item.icon === 'sunflower') !== (item.sunflower !== undefined)) {
      throw new Error(`Primary sidebar item "${item.id}" has an invalid Sunflower model.`)
    }
    if (item.badge && (
      !Number.isSafeInteger(item.badge.value) ||
      item.badge.value < 0 ||
      !item.badge.label.trim()
    )) {
      throw new Error(`Primary sidebar item "${item.id}" has an invalid badge model.`)
    }
    itemIds.add(id)
  }
  validateSidebarFolders(folders)
  if (!onContextMenuAction && items.some((item) => item.contextMenu)) {
    throw new Error('Primary sidebar context-menu items require an action receiver.')
  }
  if (folders.length > 0 && (!folderRootDropTarget || !onFolderContextMenuAction)) {
    throw new Error('Primary sidebar folders require root-drop and context-menu receivers.')
  }
  const assignedItemIds = new Set(folders.flatMap(({ itemIds }) => itemIds))
  const itemById = new Map(items.map((item) => [item.id, item]))
  const unfiledItems = items.filter((item) => !assignedItemIds.has(item.id))
  return (
    <SidebarMenu>
      {folders.map((folder) => (
        <SidebarFolderSection
          key={folder.id}
          folder={folder}
          onContextMenuAction={onFolderContextMenuAction as NonNullable<
            SidebarNavigationProps['onFolderContextMenuAction']
          >}
        >
          {folder.itemIds.map((itemId) => {
            const item = itemById.get(itemId)
            if (!item) return null
            return (
              <SidebarNavigationRow
                key={item.id}
                item={item}
                selected={item.id === selectedItemId}
                onSelect={onSelect}
                onContextMenuAction={onContextMenuAction}
              />
            )
          })}
        </SidebarFolderSection>
      ))}
      {folders.length > 0 && folderRootDropTarget && (
        <SidebarFolderRootTarget dropTarget={folderRootDropTarget} />
      )}
      {items.length === 0 ? (
        <li className="px-2 py-2 text-[0.6875rem] text-muted-foreground">{emptyLabel}</li>
      ) : (
        unfiledItems.map((item) => {
          const selected = item.id === selectedItemId
          return <SidebarNavigationRow
            key={item.id}
            item={item}
            selected={selected}
            onSelect={onSelect}
            onContextMenuAction={onContextMenuAction}
          />
        })
      )}
      <SidebarActionRow actions={actions} />
    </SidebarMenu>
  )
}
