import type { SidebarFolderSnapshot } from '../../../../shared/contracts'
import type { SidebarFolderModel } from '@/components/ui/sidebar-folder'

export const FOCUS_FOLDER_DROP_TYPE = 'sidebar-folder:focus'
export const THREAD_FOLDER_DROP_TYPE = 'sidebar-folder:thread'
export const SIDEBAR_FOLDER_ROOT_ID = 'root'

export function sidebarFolderItemId(id: number): string {
  return `folder:${id}`
}

export function sidebarFolderModels(
  folders: readonly SidebarFolderSnapshot[],
  area: { type: 'focus' } | { type: 'thread'; focusId: number },
  visibleItemIds: ReadonlySet<string>
): SidebarFolderModel[] {
  const targetType = area.type === 'focus'
    ? FOCUS_FOLDER_DROP_TYPE
    : THREAD_FOLDER_DROP_TYPE
  return folders
    .filter((folder) => folder.area.type === area.type && (
      area.type === 'focus' || (
        folder.area.type === 'thread' && folder.area.focusId === area.focusId
      )
    ))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base'
    }) || left.id - right.id)
    .map((folder) => ({
      id: sidebarFolderItemId(folder.id),
      label: folder.name,
      group: area.type === 'thread' ? { id: 'threads', label: 'Threads' } : undefined,
      itemIds: [...visibleItemIds].filter((itemId) => {
        const targetId = area.type === 'focus'
          ? Number(itemId)
          : Number(itemId.replace(/^thread:/, ''))
        return folder.targetIds.includes(targetId)
      }),
      dropTarget: { type: targetType, id: String(folder.id) },
      contextMenu: {
        ariaLabel: `${folder.name} folder actions`,
        items: [{
          kind: 'action',
          id: 'delete',
          label: 'Delete folder',
          icon: 'delete',
          tone: 'destructive'
        }]
      }
    }))
}

export function parseSidebarFolderId(id: string): number | null {
  if (!id.startsWith('folder:')) return null
  const value = Number(id.slice('folder:'.length))
  return Number.isSafeInteger(value) && value > 0 ? value : null
}
