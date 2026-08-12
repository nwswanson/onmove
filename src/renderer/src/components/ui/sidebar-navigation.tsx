import { CalendarClock, ClipboardCheck, ListChecks, PauseCircle, Plus, Tags } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { SemanticSunflower, type SemanticSunflowerModel } from '@/components/ui/sunflower'
import { TaggedText } from '@/components/ui/tagged-text'
import {
  SidebarDndBoundary,
  type SidebarTransferTargetData
} from '@/components/ui/sidebar-dnd'

/** Receiver-owned row contract for primary sidebar navigation. */
export interface SidebarNavigationItemModel {
  id: string
  label: string
  ariaLabel?: string
  icon?: 'todos' | 'tags' | 'review' | 'due' | 'sunflower' | 'paused'
  sunflower?: SemanticSunflowerModel
  tone?: 'default' | 'muted'
  disabled?: boolean
  dropTarget?: { type: string; id: string }
  badge?: {
    value: number
    label: string
  }
}

export interface SidebarNavigationActionModel {
  id: string
  label: string
  ariaLabel?: string
  icon?: 'add'
  disabled?: boolean
  onInvoke: () => void
}

export interface SidebarNavigationProps {
  items: readonly SidebarNavigationItemModel[]
  selectedItemId: string | null
  emptyLabel?: string
  action?: SidebarNavigationActionModel
  onSelect: (itemId: string) => void
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
  onSelect
}: {
  item: SidebarNavigationItemModel
  selected: boolean
  onSelect: (itemId: string) => void
}): React.JSX.Element {
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
      <SidebarMenuButton
        type="button"
        isActive={selected}
        aria-current={selected ? 'page' : undefined}
        aria-label={`${item.ariaLabel ?? item.label}${
          item.badge ? `, ${item.badge.label}` : ''
        }`}
        title={item.sunflower?.ariaLabel}
        className={cn(item.tone === 'muted' && 'text-muted-foreground opacity-55')}
        disabled={item.disabled}
        onClick={() => onSelect(item.id)}
      >
        {item.icon === 'todos' ? (
          <ListChecks aria-hidden="true" />
        ) : item.icon === 'tags' ? (
          <Tags aria-hidden="true" />
        ) : item.icon === 'review' ? (
          <ClipboardCheck aria-hidden="true" />
        ) : item.icon === 'due' ? (
          <CalendarClock aria-hidden="true" />
        ) : item.icon === 'paused' ? (
          <PauseCircle aria-hidden="true" />
        ) : item.icon === 'sunflower' && item.sunflower ? (
          <SemanticSunflower className="!size-6" model={item.sunflower} />
        ) : null}
        <span className="truncate"><TaggedText value={item.label} /></span>
        {item.badge && (
          <span
            aria-hidden="true"
            className="ml-auto min-w-5 shrink-0 rounded-full bg-sidebar-accent px-1.5 py-0.5 text-center text-[0.6875rem] font-semibold tabular-nums text-sidebar-accent-foreground group-data-[active=true]/menu-button:bg-primary/45"
          >
            {item.badge.value}
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function SidebarNavigationContent({
  items,
  selectedItemId,
  emptyLabel = 'No items',
  action,
  onSelect
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
  if (action && (!action.id.trim() || !action.label.trim())) {
    throw new Error('Primary sidebar action requires an id and label.')
  }

  return (
    <SidebarMenu>
      {items.length === 0 ? (
        <li className="px-2 py-2 text-[0.6875rem] text-muted-foreground">{emptyLabel}</li>
      ) : (
        items.map((item) => {
          const selected = item.id === selectedItemId
          return <SidebarNavigationRow
            key={item.id}
            item={item}
            selected={selected}
            onSelect={onSelect}
          />
        })
      )}
      {action && (
        <SidebarMenuItem className="mt-1 border-t border-sidebar-border pt-1">
          <SidebarMenuButton
            type="button"
            aria-label={action.ariaLabel ?? action.label}
            disabled={action.disabled}
            onClick={action.onInvoke}
          >
            {action.icon === 'add' && <Plus aria-hidden="true" />}
            <span>{action.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  )
}
