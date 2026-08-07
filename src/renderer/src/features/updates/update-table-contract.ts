import type { StateLabelModel } from '@/components/ui/state-label'

export interface UpdateTableStateOptionModel extends StateLabelModel {
  value: string
}

export interface UpdateTableDraft {
  date: string
  observation: string
  state: string
}

export interface UpdateTableRowModel extends UpdateTableDraft {
  id: string
}

export interface UpdateTableProps {
  rows: readonly UpdateTableRowModel[]
  stateOptions: readonly UpdateTableStateOptionModel[]
  defaultDate: string
  loading?: boolean
  loadError?: string | null
  onCreate: (draft: UpdateTableDraft) => Promise<void>
  onUpdate: (rowId: string, draft: UpdateTableDraft) => Promise<void>
  onDelete: (rowId: string) => Promise<void>
}

export function validateUpdateTableModel(
  rows: readonly UpdateTableRowModel[],
  stateOptions: readonly UpdateTableStateOptionModel[]
): void {
  const stateValues = new Set<string>()
  for (const option of stateOptions) {
    if (!option.value.trim() || !option.label.trim() || stateValues.has(option.value)) {
      throw new Error(`Update table contains an invalid state option "${option.value}".`)
    }
    stateValues.add(option.value)
  }
  if (stateValues.size === 0) throw new Error('Update table requires at least one state option.')

  const rowIds = new Set<string>()
  for (const row of rows) {
    if (!row.id.trim() || rowIds.has(row.id) || !stateValues.has(row.state)) {
      throw new Error(`Update table contains an invalid row "${row.id}".`)
    }
    rowIds.add(row.id)
  }
}
