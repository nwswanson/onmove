import { useMemo, useState } from 'react'
import { CheckSquare2, CircleDot, FolderKanban, GitBranch, Tag } from 'lucide-react'
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandShortcut
} from '@/components/ui/command'
import { rankedCommandMenuGroups } from '@/components/ui/command-menu-ranking'
import {
  LifecycleStatusLabel,
  type LifecycleStatusOptionModel
} from '@/components/ui/lifecycle-status'
import { StateLabel, type StateLabelModel } from '@/components/ui/state-label'

export type CommandMenuIcon = 'folder' | 'branch' | 'item' | 'check' | 'tag'

export interface CommandMenuItemModel {
  id: string
  icon: CommandMenuIcon
  label: string
  description: string
  keywords: readonly string[]
  code?: string
  status?: LifecycleStatusOptionModel
  state?: StateLabelModel
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
  ...props
}: CommandMenuProps): React.JSX.Element {
  // A search session is intentionally ephemeral. Unmounting it with the
  // dialog resets query and keyboard selection without synchronizing React
  // state from an effect when a caller closes the command externally.
  return open ? <OpenCommandMenu {...props} /> : <></>
}

function OpenCommandMenu({
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
}: Omit<CommandMenuProps, 'open'>): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [selectedItemId, setSelectedItemId] = useState('')
  const visibleGroups = useMemo(
    () => rankedCommandMenuGroups(groups, search),
    [groups, search]
  )

  const selectedValue = visibleGroups.some(({ items }) =>
    items.some(({ id }) => id === selectedItemId))
    ? selectedItemId
    : visibleGroups[0]?.items[0]?.id ?? ''

  function updateSearch(value: string): void {
    const nextGroups = rankedCommandMenuGroups(groups, value)
    setSearch(value)
    setSelectedItemId(nextGroups[0]?.items[0]?.id ?? '')
  }

  return (
    <CommandDialog
      open
      onOpenChange={onOpenChange}
      label={label}
      loop
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedItemId}
    >
      <CommandInput
        autoFocus
        placeholder={placeholder}
        value={search}
        onValueChange={updateSearch}
      />
      <CommandList label={resultsLabel}>
        {loading && groups.length === 0 ? (
          <CommandLoading label={loadingLabel}>{loadingLabel}</CommandLoading>
        ) : error ? (
          <p role="alert" className="px-4 py-10 text-center text-sm text-destructive">
            {error}
          </p>
        ) : (
          <>
            {visibleGroups.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {emptyLabel}
              </p>
            )}
            {visibleGroups.map((group) => (
              <CommandGroup key={group.id} heading={group.label}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => onSelect(item.id)}
                  >
                    <ResultIcon icon={item.icon} />
                    <span className="min-w-0 flex flex-1 items-center gap-1.5">
                      <span className="min-w-0 truncate font-medium">{item.label}</span>
                      {item.status && (
                        <LifecycleStatusLabel model={item.status} size="compact" />
                      )}
                      {item.state && <StateLabel model={item.state} size="compact" />}
                    </span>
                    <span className="max-w-[38%] truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                    {item.code && (
                      <span
                        title={`Public ID ${item.code}`}
                        aria-label={`Public ID ${item.code}`}
                        className="inline-flex h-5 shrink-0 select-text items-center rounded-md border border-border/70 bg-muted/35 px-1.5 font-mono text-[0.625rem] font-medium leading-none tracking-[-0.01em] tabular-nums text-muted-foreground"
                      >
                        {item.code}
                      </span>
                    )}
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
