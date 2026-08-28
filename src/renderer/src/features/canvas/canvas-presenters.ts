import type {
  CanvasEntityReferenceSnapshot,
  CanvasEntitySnapshot
} from '../../../../shared/contracts'
import type {
  EntityLibraryGroupModel,
  EntityLibraryItemModel
} from '@/components/ui/entity-library-sidebar'

const GROUPS = [
  ['thread', 'Threads'],
  ['commitment', 'Commitments'],
  ['routine', 'Routines'],
  ['note', 'Notes'],
  ['todo', 'Todos']
] as const

export type CanvasCardTone = 'primary' | 'success' | 'warning' | 'destructive' | 'muted'

export interface CanvasCardFactModel {
  label: string
  value: string
  tone?: CanvasCardTone
}

export interface CanvasCardModel {
  kind: CanvasEntitySnapshot['target']['type']
  kindLabel: string
  title: string
  status: string
  statusTone: CanvasCardTone
  context: string
  facts: CanvasCardFactModel[]
  preview: string | null
  sensitive: boolean
  deleted: boolean
  deletedAt: string | null
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})

function localToday(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function displayDate(value: string | null | undefined, fallback = 'Not set'): string {
  if (!value) return fallback
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  return DATE_FORMAT.format(new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12
  ))
}

function titleCase(value: string | null): string {
  if (!value) return 'No status'
  return value.replaceAll('_', ' ').replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
}

function statusTone(status: string | null): CanvasCardTone {
  if (status === 'green' || status === 'current' || status === 'done') return 'success'
  if (status === 'yellow' || status === 'overdue' || status === 'paused') return 'warning'
  if (status === 'red' || status === 'lapsed' || status === 'cancelled') return 'destructive'
  if (status === 'active' || status === 'open') return 'primary'
  return 'muted'
}

function dueTone(value: string | null | undefined, today: string): CanvasCardTone | undefined {
  if (!value) return undefined
  return value < today ? 'destructive' : value === today ? 'warning' : undefined
}

function scheduleLabel(weekdays: readonly string[] | undefined): string {
  if (!weekdays || weekdays.length === 0) return 'Not scheduled'
  return weekdays.map((weekday) => {
    const short = weekday.slice(0, 3)
    return short.charAt(0).toLocaleUpperCase() + short.slice(1)
  }).join(', ')
}

/** Converts one domain snapshot into the data-only contract owned by the widget receiver. */
export function canvasCardModel(
  entity: CanvasEntityReferenceSnapshot,
  today = localToday()
): CanvasCardModel {
  const details = entity.details
  const facts: CanvasCardFactModel[] = []

  if (entity.deleted) {
    facts.push({ label: 'Deleted', value: displayDate(entity.deletedAt, 'Unknown') })
  } else if (entity.target.type === 'thread') {
    facts.push(
      { label: 'Due', value: displayDate(details.dueDate), tone: dueTone(details.dueDate, today) },
      {
        label: 'Review',
        value: details.needsReview === false
          ? 'Excluded'
          : details.reviewFrequencyDays
            ? `Every ${details.reviewFrequencyDays}d`
            : 'Not set'
      },
      { label: 'Last update', value: displayDate(details.lastUpdateDate, 'Never') }
    )
  } else if (entity.target.type === 'commitment') {
    facts.push(
      { label: 'Due', value: displayDate(details.dueDate), tone: dueTone(details.dueDate, today) },
      {
        label: 'State',
        value: titleCase(details.state ?? null),
        tone: statusTone(details.state ?? null)
      },
      { label: 'Last update', value: displayDate(details.lastUpdateDate, 'Never') }
    )
  } else if (entity.target.type === 'routine') {
    facts.push(
      { label: 'Next check', value: displayDate(details.nextReviewDate, 'Not required') },
      {
        label: 'Progress',
        value: details.progress
          ? `${details.progress.complete} of ${details.progress.required}`
          : 'No open run'
      },
      { label: 'Schedule', value: scheduleLabel(details.scheduleWeekdays) }
    )
  } else if (entity.target.type === 'note') {
    facts.push({ label: 'Last edited', value: displayDate(details.updatedAt, 'Unknown') })
  } else {
    facts.push(
      { label: 'Due', value: displayDate(details.dueDate), tone: dueTone(details.dueDate, today) },
      {
        label: 'Scope',
        value: details.sharedAcrossSubjects
          ? 'All subjects'
          : details.subjectName ?? 'Parent'
      },
      {
        label: 'Completed',
        value: displayDate(details.completedAt, 'Open')
      }
    )
  }

  return {
    kind: entity.target.type,
    kindLabel: titleCase(entity.target.type),
    title: entity.title,
    status: entity.deleted ? 'Deleted' : titleCase(entity.status),
    statusTone: entity.deleted ? 'muted' : statusTone(entity.status),
    context: entity.context,
    facts,
    preview: details.preview ?? null,
    sensitive: entity.effectiveSensitive,
    deleted: entity.deleted,
    deletedAt: entity.deletedAt
  }
}

export function canvasEntityKey(entity: CanvasEntitySnapshot): string {
  return `${entity.target.type}:${entity.target.id}`
}

/** Translates domain entities into the library receiver's bounded row contract. */
export function canvasLibraryGroups(
  entities: readonly CanvasEntitySnapshot[],
  references: readonly CanvasEntityReferenceSnapshot[],
  hideSensitiveContent: boolean
): EntityLibraryGroupModel[] {
  const placed = new Set(references.filter(({ deleted }) => !deleted).map(canvasEntityKey))
  return GROUPS.map(([kind, label]) => ({
    id: kind,
    label,
    items: entities
      .filter((entity) =>
        entity.target.type === kind &&
        (!hideSensitiveContent || !entity.effectiveSensitive))
      .map((entity): EntityLibraryItemModel => ({
        id: canvasEntityKey(entity),
        label: entity.title,
        description: entity.context,
        status: entity.status ?? 'No status',
        icon: entity.target.type,
        disabled: placed.has(canvasEntityKey(entity))
      }))
  }))
}
