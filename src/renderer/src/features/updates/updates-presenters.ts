import type { UpdateSnapshot } from '../../../../shared/contracts'
import type {
  UpdateTableRowModel,
  UpdateTableStateOptionModel
} from '@/features/updates/update-table-contract'
import { healthStateLabel } from '@/features/shared/state-presenters'

export const UPDATE_TABLE_STATE_OPTIONS: readonly UpdateTableStateOptionModel[] = [
  { value: 'red', ...healthStateLabel('red') },
  { value: 'yellow', ...healthStateLabel('yellow') },
  { value: 'green', ...healthStateLabel('green') },
  { value: 'none', ...healthStateLabel('none') }
]

export function updateTableRows(updates: readonly UpdateSnapshot[]): UpdateTableRowModel[] {
  return updates.map((update) => ({
    id: String(update.id),
    date: update.date,
    observation: update.observation,
    state: update.state
  }))
}
