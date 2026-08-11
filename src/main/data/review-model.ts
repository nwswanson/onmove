import type {
  CommitmentScopeCellSnapshot,
  CommitmentSnapshot,
  FocusSnapshot,
  ReviewOverviewSnapshot,
  ReviewQueueItemSnapshot,
  ReviewScopeCellSnapshot,
  ThreadScopeCellSnapshot,
  ThreadSnapshot,
  UpdateScopeCell,
  UpdateSnapshot
} from '../../shared/contracts'
import { FocusRepository } from './focus'
import { ModelValidationError } from './model'
import type { SqliteAdapter } from './sqlite-adapter'
import { CommitmentRepository, ThreadRepository, UpdateRepository } from './work-model'

function today(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ModelValidationError('review asOf must use YYYY-MM-DD')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ModelValidationError('review asOf must be a real calendar date')
  }
  return value
}

function reviewCell(
  cell: ThreadScopeCellSnapshot | CommitmentScopeCellSnapshot
): ReviewScopeCellSnapshot {
  return {
    scopeId: cell.scopeId,
    subjectId: cell.subjectId,
    subject: cell.subject
  }
}

function updatesForCell(
  updates: readonly UpdateSnapshot[],
  cell: UpdateScopeCell | null
): UpdateSnapshot[] {
  return updates.filter((update) => cell === null
    ? update.scope === null
    : update.scope?.scopeId === cell.scopeId && update.scope.subjectId === cell.subjectId)
}

/**
 * Named, bounded review projection. It preserves independent Subject-cell
 * obligations and keeps the renderer from deriving due work from raw records.
 */
export class ReviewRepository {
  private readonly focuses: FocusRepository
  private readonly threads: ThreadRepository
  private readonly commitments: CommitmentRepository
  private readonly updates: UpdateRepository

  constructor(database: SqliteAdapter) {
    this.focuses = new FocusRepository(database)
    this.threads = new ThreadRepository(database)
    this.commitments = new CommitmentRepository(database)
    this.updates = new UpdateRepository(database)
  }

  getOverview(asOf = today()): ReviewOverviewSnapshot {
    const date = normalizeDate(asOf)
    const items: ReviewQueueItemSnapshot[] = []

    for (const focus of this.focuses.list(date)) {
      if (focus.status !== 'active') continue

      const focusCommitments = this.commitments.listForFocus(focus.id, date)
      if (focus.needsReview) items.push(this.focusItem(focus, focusCommitments))
      this.appendCommitmentItems(items, focus, null, focusCommitments, date)

      for (const thread of this.threads.listForFocus(focus.id, date)) {
        if (thread.status !== 'active') continue
        const threadCommitments = this.commitments.listForThread(thread.id, date)
        if (thread.reviewDue) {
          const dueCells = this.threads.scopeMatrix(thread.id, date).filter(({ reviewDue }) => reviewDue)
          if (dueCells.length === 0) {
            items.push(this.threadItem(focus, thread, null, threadCommitments))
          } else {
            items.push(...dueCells.map((cell) =>
              this.threadItem(focus, thread, cell, threadCommitments)))
          }
        }
        this.appendCommitmentItems(items, focus, thread, threadCommitments, date)
      }
    }

    return { asOf: date, items }
  }

  private focusItem(
    focus: FocusSnapshot,
    commitments: CommitmentSnapshot[]
  ): ReviewQueueItemSnapshot {
    return {
      key: `focus:${focus.id}`,
      kind: 'focus',
      focus,
      thread: null,
      commitment: null,
      cell: null,
      lastReviewDate: focus.lastReviewDate,
      nextReviewDate: null,
      state: null,
      updates: this.updates.listForFocus(focus.id),
      commitments
    }
  }

  private threadItem(
    focus: FocusSnapshot,
    thread: ThreadSnapshot,
    cell: ThreadScopeCellSnapshot | null,
    commitments: CommitmentSnapshot[]
  ): ReviewQueueItemSnapshot {
    const updates = this.updates.listForThread(thread.id)
    const scopeCell = cell ? reviewCell(cell) : null
    return {
      key: cell
        ? `thread:${thread.id}:scope:${cell.scopeId}:subject:${cell.subjectId}`
        : `thread:${thread.id}`,
      kind: 'thread',
      focus,
      thread,
      commitment: null,
      cell: scopeCell,
      lastReviewDate: cell?.lastReviewDate ?? thread.lastReviewDate,
      nextReviewDate: cell?.nextReviewDate ?? thread.nextReviewDate,
      state: cell?.state ?? thread.health,
      updates: updatesForCell(updates, scopeCell),
      commitments
    }
  }

  private appendCommitmentItems(
    items: ReviewQueueItemSnapshot[],
    focus: FocusSnapshot,
    thread: ThreadSnapshot | null,
    commitments: readonly CommitmentSnapshot[],
    asOf: string
  ): void {
    for (const commitment of commitments) {
      if (!commitment.needsUpdate || commitment.status !== 'active') continue
      const dueCells = this.commitments.scopeMatrix(commitment.id, asOf)
        .filter(({ needsUpdate }) => needsUpdate)
      if (dueCells.length === 0) {
        items.push(this.commitmentItem(focus, thread, commitment, null))
      } else {
        items.push(...dueCells.map((cell) =>
          this.commitmentItem(focus, thread, commitment, cell)))
      }
    }
  }

  private commitmentItem(
    focus: FocusSnapshot,
    thread: ThreadSnapshot | null,
    commitment: CommitmentSnapshot,
    cell: CommitmentScopeCellSnapshot | null
  ): ReviewQueueItemSnapshot {
    const updates = this.updates.listForCommitment(commitment.id)
    const scopeCell = cell ? reviewCell(cell) : null
    return {
      key: cell
        ? `commitment:${commitment.id}:scope:${cell.scopeId}:subject:${cell.subjectId}`
        : `commitment:${commitment.id}`,
      kind: 'commitment',
      focus,
      thread,
      commitment,
      cell: scopeCell,
      lastReviewDate: cell?.lastUpdateDate ?? commitment.lastReviewDate,
      nextReviewDate: cell?.nextUpdateDate ?? commitment.nextUpdateDate,
      state: cell?.state ?? commitment.state,
      updates: updatesForCell(updates, scopeCell),
      commitments: []
    }
  }
}
