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
  contextLabel?: string
  externalRevision?: string | number
}

export interface UpdateListCreateOptionModel {
  id: string
  label: string
}

export interface UpdateListProps {
  ariaLabel: string
  heading?: string
  supportingText?: string
  emptyLabel?: string
  items: readonly UpdateListItemModel[]
  formerItems?: readonly UpdateListItemModel[]
  formerItemsLabel?: string
  stateOptions: readonly UpdateListStateOptionModel[]
  defaultDate: string
  defaultState: string
  loading?: boolean
  loadError?: string | null
  /** Returns the opaque created row id when its editor should receive focus. */
  onCreate?: (draft: UpdateListDraft) => Promise<string | void>
  createOptions?: readonly UpdateListCreateOptionModel[]
  createOptionsLabel?: string
  /** Returns the opaque created row id when its editor should receive focus. */
  onCreateFor?: (optionId: string, draft: UpdateListDraft) => Promise<string | void>
  onUpdate: (itemId: string, draft: UpdateListDraft) => Promise<void>
  onObservationChange?: (itemId: string, value: string) => void
  onOpenObservation?: (itemId: string) => void
  onDelete: (itemId: string) => Promise<void>
}

export function validateUpdateListModel(
  items: readonly UpdateListItemModel[],
  stateOptions: readonly UpdateListStateOptionModel[],
  createOptions: readonly UpdateListCreateOptionModel[] = []
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

  const createOptionIds = new Set<string>()
  for (const option of createOptions) {
    if (!option.id.trim() || !option.label.trim() || createOptionIds.has(option.id)) {
      throw new Error(`Update list contains an invalid creation option "${option.id}".`)
    }
    createOptionIds.add(option.id)
  }
}
