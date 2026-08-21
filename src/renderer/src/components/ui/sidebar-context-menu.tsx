import * as React from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { Check, ClipboardCheck, ListChecks, Pin, Plus, Shield, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarContextMenuItemBase {
  id: string
  label: string
  icon?: 'add' | 'checklist' | 'review' | 'sensitive' | 'pin' | 'delete'
  tone?: 'default' | 'destructive'
  separatorBefore?: boolean
  disabled?: boolean
}

export type SidebarContextMenuItemModel = SidebarContextMenuItemBase & (
  | {
      kind: 'action'
    }
  | {
      kind: 'checkbox'
      checked: boolean
    }
)

export interface SidebarContextMenuModel {
  ariaLabel: string
  items: readonly SidebarContextMenuItemModel[]
}

interface SidebarItemContextMenuProps {
  model?: SidebarContextMenuModel
  children: React.ReactElement
  onAction: (actionId: string, checked?: boolean) => void
}

function validateModel(model: SidebarContextMenuModel): void {
  if (!model.ariaLabel.trim() || model.items.length === 0) {
    throw new Error('A sidebar context menu requires a label and at least one item.')
  }
  const ids = new Set<string>()
  for (const item of model.items) {
    const id = item.id.trim()
    if (!id || ids.has(id) || !item.label.trim()) {
      throw new Error(`Sidebar context menu contains an invalid item "${item.id}".`)
    }
    ids.add(id)
  }
}

function MenuIcon({ icon }: { icon: SidebarContextMenuItemModel['icon'] }): React.JSX.Element {
  const className = 'size-3.5 shrink-0'
  if (icon === 'add') return <Plus aria-hidden="true" className={className} />
  if (icon === 'checklist') return <ListChecks aria-hidden="true" className={className} />
  if (icon === 'review') return <ClipboardCheck aria-hidden="true" className={className} />
  if (icon === 'sensitive') return <Shield aria-hidden="true" className={className} />
  if (icon === 'pin') return <Pin aria-hidden="true" className={className} />
  if (icon === 'delete') return <Trash2 aria-hidden="true" className={className} />
  return <span aria-hidden="true" className={className} />
}

/**
 * Domain-free receiver for sidebar item context menus. Sidebar item models
 * declare only data; their owning sidebar translates selections into actions.
 */
export function SidebarItemContextMenu({
  model,
  children,
  onAction
}: SidebarItemContextMenuProps): React.JSX.Element {
  if (!model) return children
  validateModel(model)

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          aria-label={model.ariaLabel}
          collisionPadding={8}
          className="z-[80] min-w-52 overflow-hidden rounded-lg border border-border bg-card p-1 text-card-foreground shadow-xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in"
        >
          {model.items.map((item) => (
            <React.Fragment key={item.id}>
              {item.separatorBefore && (
                <ContextMenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border/75" />
              )}
              {item.kind === 'checkbox' ? (
                <ContextMenuPrimitive.CheckboxItem
                  checked={item.checked}
                  disabled={item.disabled}
                  className={cn(
                    'relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2 pr-8 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-primary/25 data-[disabled]:opacity-50',
                    item.tone === 'destructive' &&
                      'text-destructive data-[highlighted]:bg-destructive/12'
                  )}
                  onCheckedChange={(checked) => {
                    if (typeof checked === 'boolean') onAction(item.id, checked)
                  }}
                >
                  <MenuIcon icon={item.icon} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <ContextMenuPrimitive.ItemIndicator className="absolute right-2 inline-flex size-3.5 items-center justify-center">
                    <Check aria-hidden="true" className="size-3" />
                  </ContextMenuPrimitive.ItemIndicator>
                </ContextMenuPrimitive.CheckboxItem>
              ) : (
                <ContextMenuPrimitive.Item
                  disabled={item.disabled}
                  className={cn(
                    'flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-primary/25 data-[disabled]:opacity-50',
                    item.tone === 'destructive' &&
                      'text-destructive data-[highlighted]:bg-destructive/12'
                  )}
                  onSelect={() => onAction(item.id)}
                >
                  <MenuIcon icon={item.icon} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </ContextMenuPrimitive.Item>
              )}
            </React.Fragment>
          ))}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}
