import { useMemo, useState } from 'react'
import {
  CheckSquare2,
  FileText,
  GitBranch,
  GripVertical,
  Handshake,
  Repeat2,
  Search
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export type EntityLibraryIcon = 'thread' | 'commitment' | 'note' | 'routine' | 'todo'

export interface EntityLibraryItemModel {
  id: string
  label: string
  description: string
  status: string
  icon: EntityLibraryIcon
  disabled?: boolean
}

export interface EntityLibraryGroupModel {
  id: string
  label: string
  items: readonly EntityLibraryItemModel[]
}

interface EntityLibrarySidebarProps {
  title: string
  groups: readonly EntityLibraryGroupModel[]
  width: number
  onDragStart: (itemId: string, dataTransfer: DataTransfer) => void
}

function LibraryIcon({ icon }: { icon: EntityLibraryIcon }): React.JSX.Element {
  const Icon = icon === 'thread'
    ? GitBranch
    : icon === 'commitment'
      ? Handshake
      : icon === 'note'
        ? FileText
        : icon === 'routine'
          ? Repeat2
          : CheckSquare2
  return <Icon aria-hidden="true" />
}

/** Domain-free, searchable drag source for placing records onto a receiver. */
export function EntityLibrarySidebar({
  title,
  groups,
  width,
  onDragStart
}: EntityLibrarySidebarProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleGroups = useMemo(() => groups.map((group) => ({
    ...group,
    items: normalizedQuery.length === 0
      ? group.items
      : group.items.filter((item) =>
          `${item.label} ${item.description} ${item.status}`
            .toLocaleLowerCase()
            .includes(normalizedQuery))
  })).filter((group) => group.items.length > 0), [groups, normalizedQuery])

  return (
    <Sidebar aria-label="Canvas item library" style={{ width }}>
      <SidebarHeader className="gap-3 border-b border-sidebar-border px-3 py-3">
        <p className="truncate px-1 text-xs font-semibold tracking-tight">{title}</p>
        <label className="relative block">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            aria-label="Search Canvas items"
            placeholder="Search everything"
            className="h-8 bg-background pl-8 text-xs"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    type="button"
                    draggable={!item.disabled}
                    disabled={item.disabled}
                    aria-label={`${item.label}, ${item.description}, ${item.status}${
                      item.disabled ? ', already on Canvas' : ', drag onto Canvas'
                    }`}
                    className={cn(
                      'h-auto min-h-10 items-start gap-2 py-1.5',
                      !item.disabled && 'cursor-grab active:cursor-grabbing',
                      item.disabled && 'opacity-45'
                    )}
                    onDragStart={(event) => {
                      if (item.disabled) {
                        event.preventDefault()
                        return
                      }
                      onDragStart(item.id, event.dataTransfer)
                    }}
                  >
                    <LibraryIcon icon={item.icon} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{item.label}</span>
                      <span className="block truncate text-[0.6875rem] text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    <span className="mt-0.5 shrink-0 rounded-full border border-border/80 px-1.5 py-0.5 text-[0.625rem] capitalize text-muted-foreground">
                      {item.status.replace('_', ' ')}
                    </span>
                    <GripVertical className="mt-0.5 !size-3.5 text-muted-foreground/60" aria-hidden="true" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
        {visibleGroups.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No matching items
          </p>
        )}
      </SidebarContent>
    </Sidebar>
  )
}
