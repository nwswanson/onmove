import { Circle, House, PauseCircle, Plus } from 'lucide-react'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/** Receiver-owned row contract for primary sidebar navigation. */
export interface SidebarNavigationItemModel {
  id: string
  label: string
  ariaLabel?: string
  icon?: 'home' | 'item' | 'paused'
  tone?: 'default' | 'muted'
  disabled?: boolean
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
          return (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                type="button"
                isActive={selected}
                aria-current={selected ? 'page' : undefined}
                aria-label={item.ariaLabel ?? item.label}
                className={cn(item.tone === 'muted' && 'text-muted-foreground opacity-55')}
                disabled={item.disabled}
                onClick={() => onSelect(item.id)}
              >
                {item.icon === 'home' ? (
                  <House aria-hidden="true" />
                ) : item.icon === 'paused' ? (
                  <PauseCircle aria-hidden="true" />
                ) : item.icon === 'item' ? (
                  <Circle aria-hidden="true" />
                ) : null}
                <span className="truncate">{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
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
