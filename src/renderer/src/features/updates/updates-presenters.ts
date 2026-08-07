import type { UpdateSnapshot } from '../../../../shared/contracts'
import type {
  UpdateListItemModel,
  UpdateListStateOptionModel
} from '@/features/updates/update-list-contract'
import { healthStateLabel } from '@/features/shared/state-presenters'

export const UPDATE_LIST_STATE_OPTIONS: readonly UpdateListStateOptionModel[] = [
  { value: 'red', ...healthStateLabel('red') },
  { value: 'yellow', ...healthStateLabel('yellow') },
  { value: 'green', ...healthStateLabel('green') },
  { value: 'none', ...healthStateLabel('none') }
]

export function updateListItems(updates: readonly UpdateSnapshot[]): UpdateListItemModel[] {
  return updates.map((update) => ({
    id: String(update.id),
    date: update.date,
    observation: update.observation,
    state: update.state
  }))
}
