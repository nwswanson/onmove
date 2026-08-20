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
  /** Changes only for observation commits made outside the mounted editor. */
  externalObservationRevisions?: ReadonlyMap<number, number>
}

export interface UpdateListProjection {
  items: UpdateListItemModel[]
  formerItems: UpdateListItemModel[]
}

export function updateListProjection(
  updates: readonly UpdateSnapshot[],
  context?: UpdateListContextModel
): UpdateListProjection {
  const projection: UpdateListProjection = { items: [], formerItems: [] }
  for (const update of updates) {
    const subjectLabel = update.scope
      ? context?.subjectLabels.get(update.scope.subjectId)
      : undefined
    // Scope overlays are immutable application-history nodes. A remove/add
    // cycle may replace the internal Scope id while restoring the same
    // canonical Subject, so current applicability must be classified by
    // Subject membership rather than raw Scope identity.
    const formerScope = context?.currentSubjectIds !== undefined && (
      update.scope === null || !context.currentSubjectIds.has(update.scope.subjectId)
    )
    const contextLabel = formerScope
      ? subjectLabel
        ? `${subjectLabel} · Former scope`
        : 'Former scope'
      : subjectLabel
    const item = {
      id: String(update.id),
      date: update.date,
      observation: update.observation,
      state: update.state,
      sensitive: update.sensitive,
      historyReference: { type: 'update' as const, id: update.id, field: 'observation' as const },
      ...(context?.externalObservationRevisions?.has(update.id)
        ? { externalRevision: context.externalObservationRevisions.get(update.id) }
        : {}),
      ...(contextLabel ? { contextLabel } : {})
    }
    if (formerScope) projection.formerItems.push(item)
    else projection.items.push(item)
  }
  return projection
}

export function updateListItems(
  updates: readonly UpdateSnapshot[],
  context?: UpdateListContextModel
): UpdateListItemModel[] {
  const projection = updateListProjection(updates, context)
  return [...projection.items, ...projection.formerItems]
}
