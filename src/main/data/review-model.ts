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

function isUnreviewedToday(item: ReviewQueueItemSnapshot, asOf: string): boolean {
  return item.lastReviewDate === null || item.lastReviewDate < asOf
}

function appendIfEligible(
  items: ReviewQueueItemSnapshot[],
  item: ReviewQueueItemSnapshot,
  asOf: string
): void {
  const participates = item.lastReviewDate === null || item.due
  if (participates && isUnreviewedToday(item, asOf)) items.push(item)
}

/**
 * Named, bounded review projection. It preserves independent Subject-cell
 * review targets and keeps the renderer from deriving eligibility or due state
 * from raw records.
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
      if (focus.status !== 'active' || !focus.needsReview) continue

      const focusCommitments = this.commitments.listForFocus(focus.id, date)
      this.appendCommitmentItems(items, focus, null, focusCommitments, date)

      for (const thread of this.threads.listForFocus(focus.id, date)) {
        if (thread.status !== 'active') continue
        const threadCommitments = this.commitments.listForThread(thread.id, date)
        if (thread.needsReview) {
          const cells = this.threads.scopeMatrix(thread.id, date)
          if (cells.length === 0) {
            appendIfEligible(
              items,
              this.threadItem(focus, thread, null, threadCommitments),
              date
            )
          } else {
            for (const cell of cells) {
              appendIfEligible(
                items,
                this.threadItem(focus, thread, cell, threadCommitments),
                date
              )
            }
          }
        }
        this.appendCommitmentItems(items, focus, thread, threadCommitments, date)
      }
    }

    return { asOf: date, items }
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
      lastReviewDate: cell ? cell.lastReviewDate : thread.lastReviewDate,
      nextReviewDate: cell ? cell.nextReviewDate : thread.nextReviewDate,
      due: cell ? cell.reviewDue : thread.reviewDue,
      state: cell ? cell.state : thread.health,
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
      if (commitment.status !== 'active' || !commitment.needsReview) continue
      const cells = this.commitments.scopeMatrix(commitment.id, asOf)
      if (cells.length === 0) {
        appendIfEligible(
          items,
          this.commitmentItem(focus, thread, commitment, null),
          asOf
        )
      } else {
        for (const cell of cells) {
          appendIfEligible(
            items,
            this.commitmentItem(focus, thread, commitment, cell),
            asOf
          )
        }
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
      lastReviewDate: cell ? cell.lastReviewDate : commitment.lastReviewDate,
      nextReviewDate: cell ? cell.nextReviewDate : commitment.nextReviewDate,
      due: cell ? cell.reviewDue : commitment.reviewDue,
      state: cell ? cell.state : commitment.state,
      updates: updatesForCell(updates, scopeCell),
      commitments: []
    }
  }
}
