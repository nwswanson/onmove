import type {
  CommitmentSnapshot,
  DueOverviewSnapshot,
  DueWorkItemSnapshot,
  FocusSnapshot,
  ThreadSnapshot
} from '../../shared/contracts'
import { FocusRepository } from './focus'
import { ModelValidationError } from './model'
import type { SqliteAdapter } from './sqlite-adapter'
import { CommitmentRepository, ThreadRepository } from './work-model'

function today(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ModelValidationError('due overview asOf must use YYYY-MM-DD')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ModelValidationError('due overview asOf must be a real calendar date')
  }
  return value
}

function focusItem(focus: FocusSnapshot): DueWorkItemSnapshot | null {
  if (!focus.dueDate) return null
  return {
    key: `focus:${focus.id}`,
    kind: 'focus',
    focus,
    thread: null,
    commitment: null,
    dueDate: focus.dueDate,
    parent: null
  }
}

function threadItem(
  focus: FocusSnapshot,
  thread: ThreadSnapshot
): DueWorkItemSnapshot | null {
  if (!thread.dueDate) return null
  return {
    key: `thread:${thread.id}`,
    kind: 'thread',
    focus,
    thread,
    commitment: null,
    dueDate: thread.dueDate,
    parent: { kind: 'focus', title: focus.title, dueDate: focus.dueDate }
  }
}

function commitmentItem(
  focus: FocusSnapshot,
  thread: ThreadSnapshot | null,
  commitment: CommitmentSnapshot
): DueWorkItemSnapshot | null {
  if (!commitment.dueDate) return null
  return {
    key: `commitment:${commitment.id}`,
    kind: 'commitment',
    focus,
    thread,
    commitment,
    dueDate: commitment.dueDate,
    parent: thread
      ? { kind: 'thread', title: thread.title, dueDate: thread.dueDate }
      : { kind: 'focus', title: focus.title, dueDate: focus.dueDate }
  }
}

function recordTitle(item: DueWorkItemSnapshot): string {
  return item.commitment?.title ?? item.thread?.title ?? item.focus.title
}

/**
 * Named aggregate projection for deadline operations. The model returns every
 * persisted Focus, Thread, or Commitment with an explicit due date, including
 * closed work, and globally orders it by date before hierarchy or title.
 */
export class DueRepository {
  private readonly focuses: FocusRepository
  private readonly threads: ThreadRepository
  private readonly commitments: CommitmentRepository

  constructor(database: SqliteAdapter) {
    this.focuses = new FocusRepository(database)
    this.threads = new ThreadRepository(database)
    this.commitments = new CommitmentRepository(database)
  }

  getOverview(asOf = today()): DueOverviewSnapshot {
    const date = normalizeDate(asOf)
    const items: DueWorkItemSnapshot[] = []

    for (const focus of this.focuses.list(date)) {
      const focusDue = focusItem(focus)
      if (focusDue) items.push(focusDue)

      for (const commitment of this.commitments.listForFocus(focus.id, date)) {
        const item = commitmentItem(focus, null, commitment)
        if (item) items.push(item)
      }

      for (const thread of this.threads.listForFocus(focus.id, date)) {
        const threadDue = threadItem(focus, thread)
        if (threadDue) items.push(threadDue)
        for (const commitment of this.commitments.listForThread(thread.id, date)) {
          const item = commitmentItem(focus, thread, commitment)
          if (item) items.push(item)
        }
      }
    }

    items.sort((left, right) => {
      const byDate = left.dueDate.localeCompare(right.dueDate)
      if (byDate !== 0) return byDate
      const byFocus = left.focus.title.localeCompare(right.focus.title)
      if (byFocus !== 0) return byFocus
      const byThread = (left.thread?.title ?? '').localeCompare(right.thread?.title ?? '')
      if (byThread !== 0) return byThread
      const byTitle = recordTitle(left).localeCompare(recordTitle(right))
      if (byTitle !== 0) return byTitle
      return left.key.localeCompare(right.key)
    })

    return { asOf: date, items }
  }
}
