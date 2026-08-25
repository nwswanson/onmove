import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub
} from '@/components/ui/sidebar'
import {
  SidebarItemContextMenu,
  type SidebarContextMenuModel
} from '@/components/ui/sidebar-context-menu'
import type { SidebarTransferTargetData } from '@/components/ui/sidebar-dnd'
import { cn } from '@/lib/utils'

export interface SidebarFolderModel {
  id: string
  label: string
  group?: { id: string; label: string }
  itemIds: readonly string[]
  dropTarget: { type: string; id: string }
  contextMenu: SidebarContextMenuModel
}

function useFolderDropTarget(dropTarget: SidebarFolderModel['dropTarget']): {
  isOver: boolean
  setNodeRef: (node: HTMLElement | null) => void
} {
  return useDroppable({
    id: `sidebar-folder-target:${dropTarget.type}:${dropTarget.id}`,
    data: {
      kind: 'sidebar-transfer-target',
      targetType: dropTarget.type,
      targetId: dropTarget.id
    } satisfies SidebarTransferTargetData
  })
}

/** Domain-free visual folder. It owns disclosure, drop feedback, and context-menu markup. */
export function SidebarFolderSection({
  folder,
  children,
  onContextMenuAction
}: {
  folder: SidebarFolderModel
  children: ReactNode
  onContextMenuAction: (folderId: string, actionId: string, checked?: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const { isOver, setNodeRef } = useFolderDropTarget(folder.dropTarget)
  return (
    <SidebarMenuItem
      ref={setNodeRef}
      data-slot="sidebar-folder"
      data-folder-id={folder.id}
      data-drop-target={isOver ? 'active' : 'inactive'}
      className={cn(isOver && 'rounded-lg ring-2 ring-primary/55')}
    >
      <SidebarItemContextMenu
        model={folder.contextMenu}
        onAction={(actionId, checked) =>
          onContextMenuAction(folder.id, actionId, checked)}
      >
        <SidebarMenuButton
          type="button"
          className="h-8 text-xs text-sidebar-foreground/70"
          aria-expanded={open}
          aria-label={`${folder.label} folder`}
          onClick={() => setOpen((current) => !current)}
        >
          {open
            ? <ChevronDown aria-hidden="true" className="!size-3.5" />
            : <ChevronRight aria-hidden="true" className="!size-3.5" />}
          <Folder aria-hidden="true" className="!size-3.5" />
          <span className="min-w-0 flex-1 truncate">{folder.label}</span>
        </SidebarMenuButton>
      </SidebarItemContextMenu>
      {open && (
        <SidebarMenuSub aria-label={`${folder.label} folder contents`}>
          {children}
          {folder.itemIds.length === 0 && (
            <li className="px-2 py-1 text-[0.6875rem] text-muted-foreground">Empty</li>
          )}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  )
}

/** Explicit root target lets a dragged item leave a folder without deleting that folder. */
export function SidebarFolderRootTarget({
  label = 'Unfiled',
  dropTarget
}: {
  label?: string
  dropTarget: { type: string; id: string }
}): React.JSX.Element {
  const { isOver, setNodeRef } = useDroppable({
    id: `sidebar-folder-root-target:${dropTarget.type}:${dropTarget.id}`,
    data: {
      kind: 'sidebar-transfer-target',
      targetType: dropTarget.type,
      targetId: dropTarget.id
    } satisfies SidebarTransferTargetData
  })
  return (
    <li
      ref={setNodeRef}
      data-slot="sidebar-folder-root-target"
      data-drop-target={isOver ? 'active' : 'inactive'}
      className={cn(
        'mt-1 rounded-md px-2 py-1 text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase',
        isOver && 'bg-primary/20 ring-2 ring-primary/55'
      )}
    >
      {label}
    </li>
  )
}

export function validateSidebarFolders(folders: readonly SidebarFolderModel[]): void {
  const folderIds = new Set<string>()
  const assignedIds = new Set<string>()
  for (const folder of folders) {
    const id = folder.id.trim()
    if (!id || folderIds.has(id) || !folder.label.trim()) {
      throw new Error(`Sidebar contains an invalid folder "${folder.id}".`)
    }
    if (!folder.dropTarget.type.trim() || !folder.dropTarget.id.trim()) {
      throw new Error(`Sidebar folder "${id}" requires a drop target.`)
    }
    for (const itemId of folder.itemIds) {
      // Item providers can reconcile one render after a cross-window folder
      // event. Missing ids are temporarily ignored by the receiver; duplicate
      // assignment is always invalid.
      if (assignedIds.has(itemId)) {
        throw new Error(`Sidebar folder "${id}" contains invalid item "${itemId}".`)
      }
      assignedIds.add(itemId)
    }
    folderIds.add(id)
  }
}
