import type {
  DueOverviewSnapshot,
  DueWorkItemSnapshot,
  FocusStatus
} from '../../../../shared/contracts'
import type { FocusWorkspaceDestinationTarget } from '@/features/application/application-navigation'
import type { ParentDueDateModel } from '@/features/shared/work-due-date'

export type DueUrgency = 'overdue' | 'today' | 'upcoming'

export interface DueWorkRowModel {
  id: string
  kind: 'focus' | 'thread' | 'commitment'
  kindLabel: 'Focus' | 'Thread' | 'Commitment'
  title: string
  locationLabel: string
  dueDate: string
  status: FocusStatus
  parent: ParentDueDateModel | null
  urgency: DueUrgency
  destination: FocusWorkspaceDestinationTarget
}

export interface DueWorkGroupModel {
  id: DueUrgency
  label: string
  rows: DueWorkRowModel[]
}

function recordIsVisible(
  item: DueWorkItemSnapshot,
  hideSensitiveContent: boolean
): boolean {
  if (!hideSensitiveContent) return true
  return !(
    item.focus.sensitive ||
    item.thread?.sensitive ||
    item.commitment?.sensitive
  )
}

function urgencyFor(dueDate: string, asOf: string): DueUrgency {
  if (dueDate < asOf) return 'overdue'
  if (dueDate === asOf) return 'today'
  return 'upcoming'
}

function rowFor(item: DueWorkItemSnapshot, asOf: string): DueWorkRowModel {
  const record = item.commitment ?? item.thread ?? item.focus
  const threadId = item.thread?.id ?? null
  const commitmentId = item.commitment?.id ?? null
  return {
    id: item.key,
    kind: item.kind,
    kindLabel: item.kind === 'focus'
      ? 'Focus'
      : item.kind === 'thread'
        ? 'Thread'
        : 'Commitment',
    title: record.title,
    locationLabel: item.kind === 'focus'
      ? 'Portfolio'
      : item.kind === 'thread'
        ? item.focus.title
        : `${item.focus.title} › ${item.thread?.title ?? 'Overall'}`,
    dueDate: item.dueDate,
    status: record.status,
    parent: item.parent
      ? { label: item.parent.kind === 'focus' ? 'Focus' : 'Thread', dueDate: item.parent.dueDate }
      : null,
    urgency: urgencyFor(item.dueDate, asOf),
    destination: {
      focusId: item.focus.id,
      threadId,
      commitmentId,
      subjectId: null
    }
  }
}

const GROUPS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Due today' },
  { id: 'upcoming', label: 'Upcoming' }
] as const

/** Translates the aggregate deadline model into urgency sections owned by the table. */
export function dueWorkGroups(
  overview: DueOverviewSnapshot,
  hideSensitiveContent: boolean
): DueWorkGroupModel[] {
  const rows = overview.items
    .filter((item) => recordIsVisible(item, hideSensitiveContent))
    .map((item) => rowFor(item, overview.asOf))
    .sort((left, right) => {
      const byDate = left.dueDate.localeCompare(right.dueDate)
      if (byDate !== 0) return byDate
      const byLocation = left.locationLabel.localeCompare(right.locationLabel)
      if (byLocation !== 0) return byLocation
      const byTitle = left.title.localeCompare(right.title)
      return byTitle !== 0 ? byTitle : left.id.localeCompare(right.id)
    })

  return GROUPS.map((group) => ({
    ...group,
    rows: rows.filter(({ urgency }) => urgency === group.id)
  })).filter(({ rows: groupRows }) => groupRows.length > 0)
}
