export interface TodoListItemModel {
  id: string
  name: string
  dueDate: string | null
  done: boolean
  overdue: boolean
  contextLabel?: string
}

export interface TodoListCreateTargetModel {
  id: string
  label: string
}

export interface TodoListDraft {
  name: string
  dueDate: string | null
}

export interface TodoListProps {
  ariaLabel: string
  items: readonly TodoListItemModel[]
  orphanedItems?: readonly TodoListItemModel[]
  orphanedItemsLabel?: string
  loading?: boolean
  loadError?: string | null
  createTargets?: readonly TodoListCreateTargetModel[]
  defaultCreateTargetId?: string
  onCreate: (draft: TodoListDraft, targetId?: string) => Promise<void>
  onUpdate: (
    itemId: string,
    input: Partial<Pick<TodoListItemModel, 'name' | 'dueDate' | 'done'>>
  ) => Promise<void>
  onDelete: (itemId: string) => Promise<void>
  onReorder: (orderedItemIds: readonly string[]) => Promise<void>
}

export function validateTodoListModel(
  items: readonly TodoListItemModel[],
  createTargets: readonly TodoListCreateTargetModel[]
): void {
  const itemIds = new Set<string>()
  for (const item of items) {
    if (!item.id.trim() || !item.name.trim() || itemIds.has(item.id)) {
      throw new Error(`Todo list contains an invalid item "${item.id}".`)
    }
    if (item.overdue && (item.done || item.dueDate === null)) {
      throw new Error(`Todo list contains an invalid overdue item "${item.id}".`)
    }
    itemIds.add(item.id)
  }

  const targetIds = new Set<string>()
  for (const target of createTargets) {
    if (!target.id.trim() || !target.label.trim() || targetIds.has(target.id)) {
      throw new Error(`Todo list contains an invalid create target "${target.id}".`)
    }
    targetIds.add(target.id)
  }
}
