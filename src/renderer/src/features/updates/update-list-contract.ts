import type { StateLabelModel } from '@/components/ui/state-label'

export interface UpdateListStateOptionModel extends StateLabelModel {
  value: string
}

export interface UpdateListDraft {
  date: string
  observation: string
  state: string
  sensitive: boolean
}

export interface UpdateListItemModel extends UpdateListDraft {
  id: string
}

export interface UpdateListProps {
  ariaLabel: string
  items: readonly UpdateListItemModel[]
  stateOptions: readonly UpdateListStateOptionModel[]
  defaultDate: string
  defaultState: string
  loading?: boolean
  loadError?: string | null
  onCreate: (draft: UpdateListDraft) => Promise<void>
  onUpdate: (itemId: string, draft: UpdateListDraft) => Promise<void>
  onDelete: (itemId: string) => Promise<void>
}

export function validateUpdateListModel(
  items: readonly UpdateListItemModel[],
  stateOptions: readonly UpdateListStateOptionModel[]
): void {
  const stateValues = new Set<string>()
  for (const option of stateOptions) {
    if (!option.value.trim() || !option.label.trim() || stateValues.has(option.value)) {
      throw new Error(`Update list contains an invalid state option "${option.value}".`)
    }
    stateValues.add(option.value)
  }
  if (stateValues.size === 0) throw new Error('Update list requires at least one state option.')

  const itemIds = new Set<string>()
  for (const item of items) {
    if (!item.id.trim() || itemIds.has(item.id) || !stateValues.has(item.state)) {
      throw new Error(`Update list contains an invalid item "${item.id}".`)
    }
    itemIds.add(item.id)
  }
}
