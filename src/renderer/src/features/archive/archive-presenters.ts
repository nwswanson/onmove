import type {
  ArchivedUpdateSnapshot
} from '../../../../shared/contracts'
import type { StateLabelModel } from '@/components/ui/state-label'
import type { EntityReferenceModel } from '@/components/ui/entity-reference'
import { healthStateLabel } from '@/features/shared/state-presenters'
import { entityReference } from '../../../../shared/entity-reference'

export interface ArchivedUpdateItemModel {
  id: string
  reference: EntityReferenceModel
  contextLabel: string
  recordedOn: string
  deletedAt: string
  deletedLabel: string
  observation: string
  state: StateLabelModel
  sensitive: boolean
}

const deletedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function parentFallback(update: ArchivedUpdateSnapshot): string {
  const label = update.parent.type[0].toUpperCase() + update.parent.type.slice(1)
  return `Former ${label} ${entityReference(update.parent.type, update.parent.id)}`
}

function contextLabel(update: ArchivedUpdateSnapshot): string {
  const labels = [
    update.context.focusTitle,
    update.context.threadTitle,
    update.context.commitmentTitle
  ].filter((label): label is string => Boolean(label?.trim()))
  if (labels.length === 0) labels.push(parentFallback(update))
  if (update.scope) {
    labels.push(
      update.context.subjectName?.trim() ||
      `Subject ${entityReference('subject', update.scope.subjectId)}`
    )
  }
  return labels.join(' › ')
}

function deletedLabel(deletedAt: string): string {
  const date = new Date(deletedAt)
  return Number.isNaN(date.getTime()) ? deletedAt : deletedAtFormatter.format(date)
}

/** Translates immutable archive snapshots into the read-only list receiver contract. */
export function archivedUpdateItems(
  updates: readonly ArchivedUpdateSnapshot[],
  hideSensitiveContent: boolean
): ArchivedUpdateItemModel[] {
  return updates
    .filter((update) => !hideSensitiveContent || !update.effectiveSensitive)
    .map((update) => ({
      id: update.archiveId,
      reference: {
        value: entityReference('update', update.originalUpdateId),
        label: 'Original Update ID'
      },
      contextLabel: contextLabel(update),
      recordedOn: update.date,
      deletedAt: update.deletedAt,
      deletedLabel: deletedLabel(update.deletedAt),
      observation: update.observation,
      state: healthStateLabel(update.state),
      sensitive: update.effectiveSensitive
    }))
}
