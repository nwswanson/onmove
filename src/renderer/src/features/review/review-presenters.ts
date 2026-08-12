import type {
  ReviewQueueItemSnapshot,
  UpdateSnapshot
} from '../../../../shared/contracts'
import type { LifecycleStatusOptionModel } from '@/components/ui/lifecycle-status'
import type { StateLabelModel } from '@/components/ui/state-label'
import { buildCommitmentListModel } from '@/features/focus/commitment-list-model'
import { dateOrNeverLabel } from '@/features/focus/focus-presenters'
import { healthStateLabel } from '@/features/shared/state-presenters'
import { workStatusLabel } from '@/features/shared/work-status'

export interface ReviewCommitmentRowModel {
  id: string
  title: string
  status: LifecycleStatusOptionModel
  state: StateLabelModel
  lastUpdatedLabel: string
}

export interface ReviewUpdateRowModel {
  id: string
  date: string
  observation: string
  state: StateLabelModel
}

export interface ReviewItemModel {
  key: string
  kindLabel: 'Focus' | 'Thread' | 'Commitment'
  title: string
  contextLabel: string
  subjectLabel: string | null
  status: LifecycleStatusOptionModel
  state: StateLabelModel | null
  lastReviewLabel: string
  nextReviewLabel: string | null
  due: boolean
  goal: string | null
  description: string | null
  dueDate: string | null
  cadenceDays: number | null
  commitments: ReviewCommitmentRowModel[]
  updates: ReviewUpdateRowModel[]
}

export function reviewItemIsVisible(
  item: ReviewQueueItemSnapshot,
  hideSensitiveContent: boolean
): boolean {
  if (!hideSensitiveContent) return true
  return !(
    item.focus.sensitive ||
    item.thread?.sensitive ||
    item.commitment?.sensitive ||
    item.cell?.subject.sensitive
  )
}

function visibleUpdates(
  item: ReviewQueueItemSnapshot,
  hideSensitiveContent: boolean
): UpdateSnapshot[] {
  if (!hideSensitiveContent) return item.updates
  return item.updates.filter(({ sensitive }) => !sensitive)
}

/** Translates a due domain target into the receiver-owned review surface. */
export function reviewItemModel(
  item: ReviewQueueItemSnapshot,
  hideSensitiveContent: boolean
): ReviewItemModel {
  const record = item.commitment ?? item.thread ?? item.focus
  const commitments = buildCommitmentListModel(
    hideSensitiveContent
      ? item.commitments.filter(({ sensitive }) => !sensitive)
      : item.commitments
  ).groups.flatMap(({ commitments: groupCommitments }) => groupCommitments)
  const updates = [...visibleUpdates(item, hideSensitiveContent)]
    .sort((left, right) => left.date === right.date
      ? right.id - left.id
      : right.date.localeCompare(left.date))
    .slice(0, 5)

  return {
    key: item.key,
    kindLabel: item.kind === 'focus'
      ? 'Focus'
      : item.kind === 'thread'
        ? 'Thread'
        : 'Commitment',
    title: record.title,
    contextLabel: item.kind === 'focus'
      ? 'Portfolio'
      : item.kind === 'thread'
        ? item.focus.title
        : `${item.focus.title} · ${item.thread?.title ?? 'Overall'}`,
    subjectLabel: item.cell?.subject.name ?? null,
    status: workStatusLabel(record.status),
    state: item.state === null ? null : healthStateLabel(item.state),
    lastReviewLabel: dateOrNeverLabel(item.lastReviewDate),
    nextReviewLabel: item.nextReviewDate,
    due: item.due,
    goal: item.kind === 'focus' && item.focus.goal ? item.focus.goal : null,
    description: item.kind === 'focus' ? item.focus.description : null,
    dueDate: record.dueDate,
    cadenceDays: item.commitment?.cadenceDays ?? null,
    commitments: commitments.map((commitment) => ({
      id: String(commitment.id),
      title: commitment.title,
      status: workStatusLabel(commitment.status),
      state: healthStateLabel(commitment.state),
      lastUpdatedLabel: dateOrNeverLabel(commitment.lastUpdateDate)
    })),
    updates: updates.map((update) => ({
      id: String(update.id),
      date: update.date,
      observation: update.observation,
      state: healthStateLabel(update.state)
    }))
  }
}
