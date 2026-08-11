import { useMemo } from 'react'
import { CommandMenu } from '@/components/ui/command-menu'
import {
  commandPaletteGroups,
  type CommandPaletteDestination
} from '@/features/application/command-palette-presenters'
import { useCommandPaletteModel } from '@/features/application/use-command-palette-model'
import type { FocusSnapshot } from '../../../../shared/contracts'

interface ApplicationCommandPaletteProps {
  open: boolean
  focuses: readonly FocusSnapshot[]
  hideSensitiveContent: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (destination: CommandPaletteDestination) => void
}

export function ApplicationCommandPalette({
  open,
  focuses,
  hideSensitiveContent,
  onOpenChange,
  onSelect
}: ApplicationCommandPaletteProps): React.JSX.Element {
  const model = useCommandPaletteModel({ open, focuses })
  const groups = useMemo(
    () => model.snapshot
      ? commandPaletteGroups(model.snapshot, hideSensitiveContent)
      : [],
    [hideSensitiveContent, model.snapshot]
  )
  const destinations = useMemo(
    () => new Map(groups.flatMap(({ items }) =>
      items.map((item) => [item.id, item.destination] as const))),
    [groups]
  )

  function select(itemId: string): void {
    const destination = destinations.get(itemId)
    if (!destination) return
    onOpenChange(false)
    onSelect(destination)
  }

  return (
    <CommandMenu
      open={open}
      label="Jump to anything"
      placeholder="Search Focuses, Threads, Commitments, Todos, and Tags…"
      groups={groups}
      loading={model.loading}
      error={model.error}
      onOpenChange={onOpenChange}
      onSelect={select}
    />
  )
}
