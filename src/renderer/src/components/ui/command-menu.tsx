import { CheckSquare2, CircleDot, FolderKanban, GitBranch, Tag } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandShortcut
} from '@/components/ui/command'

export type CommandMenuIcon = 'folder' | 'branch' | 'item' | 'check' | 'tag'

export interface CommandMenuItemModel {
  id: string
  icon: CommandMenuIcon
  label: string
  description: string
  keywords: readonly string[]
}

export interface CommandMenuGroupModel {
  id: string
  label: string
  items: readonly CommandMenuItemModel[]
}

interface CommandMenuProps {
  open: boolean
  label: string
  placeholder: string
  resultsLabel?: string
  emptyLabel?: string
  loadingLabel?: string
  shortcutLabel?: string
  groups: readonly CommandMenuGroupModel[]
  loading: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSelect: (itemId: string) => void
}

function ResultIcon({ icon }: { icon: CommandMenuIcon }): React.JSX.Element {
  const className = 'size-4 shrink-0 text-muted-foreground'
  switch (icon) {
    case 'folder': return <FolderKanban className={className} aria-hidden="true" />
    case 'branch': return <GitBranch className={className} aria-hidden="true" />
    case 'item': return <CircleDot className={className} aria-hidden="true" />
    case 'check': return <CheckSquare2 className={className} aria-hidden="true" />
    case 'tag': return <Tag className={className} aria-hidden="true" />
  }
}

/** Domain-free Spotlight-style receiver; callers supply data and receive only a selected id. */
export function CommandMenu({
  open,
  label,
  placeholder,
  resultsLabel = 'Navigation results',
  emptyLabel = 'No matching destination.',
  loadingLabel = 'Loading destinations…',
  shortcutLabel = '⌘K',
  groups,
  loading,
  error,
  onOpenChange,
  onSelect
}: CommandMenuProps): React.JSX.Element {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label={label} loop>
      <CommandInput autoFocus placeholder={placeholder} />
      <CommandList label={resultsLabel}>
        {loading && groups.length === 0 ? (
          <CommandLoading label={loadingLabel}>{loadingLabel}</CommandLoading>
        ) : error ? (
          <p role="alert" className="px-4 py-10 text-center text-sm text-destructive">
            {error}
          </p>
        ) : (
          <>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.id} heading={group.label}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.description} ${item.id}`}
                    keywords={[...item.keywords]}
                    onSelect={() => onSelect(item.id)}
                  >
                    <ResultIcon icon={item.icon} />
                    <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                    <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </>
        )}
      </CommandList>
      <div className="flex items-center gap-4 border-t border-border/75 px-4 py-2 text-[0.6875rem] text-muted-foreground">
        <span>Navigate ↑↓</span>
        <span>Select ↵</span>
        <span>Close esc</span>
        <CommandShortcut>{shortcutLabel}</CommandShortcut>
      </div>
    </CommandDialog>
  )
}
