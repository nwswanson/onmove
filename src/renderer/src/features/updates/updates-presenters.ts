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

export interface UpdateListContextModel {
  subjectLabels: ReadonlyMap<number, string>
  currentSubjectIds?: ReadonlySet<number>
}

export function updateListItems(
  updates: readonly UpdateSnapshot[],
  context?: UpdateListContextModel
): UpdateListItemModel[] {
  return updates.map((update) => {
    const subjectLabel = update.scope
      ? context?.subjectLabels.get(update.scope.subjectId)
      : undefined
    // Scope overlays are immutable application-history nodes. A remove/add
    // cycle may replace the internal Scope id while restoring the same
    // canonical Subject, so current applicability must be classified by
    // Subject membership rather than raw Scope identity.
    const formerScope = update.scope && context?.currentSubjectIds !== undefined &&
      !context.currentSubjectIds.has(update.scope.subjectId)
    const contextLabel = formerScope
      ? subjectLabel
        ? `${subjectLabel} · Former scope`
        : 'Former scope'
      : subjectLabel
    return {
      id: String(update.id),
      date: update.date,
      observation: update.observation,
      state: update.state,
      sensitive: update.sensitive,
      ...(contextLabel ? { contextLabel } : {})
    }
  })
}
