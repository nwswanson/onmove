import type {
  RichTextDocumentReference,
  RichTextDocumentSnapshot,
  RichTextHistoryReference,
  RichTextHistoryReason,
  RichTextHistorySnapshot
} from '../../shared/contracts'
import { richTextPlainText } from '../../shared/rich-text-value'
import { ModelNotFoundError, ModelValidationError } from './model'
import type { SqliteAdapter } from './sqlite-adapter'

export const RICH_TEXT_HISTORY_LIMIT = 30
export const RICH_TEXT_HISTORY_IDLE_MS = 5 * 60 * 1_000
export const RICH_TEXT_HISTORY_ELAPSED_MS = 15 * 60 * 1_000

const LARGE_EDIT_SIZE = 512
const LARGE_EDIT_RATIO_SIZE = 96
const LARGE_EDIT_RATIO = 0.6
const ACCUMULATED_EDIT_SIZE = 768
const ACCUMULATED_RATIO_SIZE = 192
const ACCUMULATED_EDIT_RATIO = 0.4
const MEANINGFUL_SESSION_SIZE = 8
const MEANINGFUL_STRUCTURE_SIZE = 64

type RichTextHistoryDocumentType =
  | 'focus-description'
  | 'update-observation'
  | 'note-content'
  | 'routine-attestation-note'

interface HistoryStateRow {
  baseline_revision: number
  baseline_value: string
  baseline_at: string
  last_edit_at: string
  edits_since_snapshot: number
  accumulated_change: number
}

interface HistoryRow {
  revision: number
  value: string
  changed_at: string
  reason: string
  edit_count: number
  change_size: number
}

interface Difference {
  size: number
  ratio: number
}

function documentType(reference: RichTextHistoryReference): RichTextHistoryDocumentType {
  if (reference.type === 'focus') return 'focus-description'
  if (reference.type === 'update') return 'update-observation'
  if (reference.type === 'routine-attestation') return 'routine-attestation-note'
  return 'note-content'
}

function difference(left: string, right: string): Difference {
  if (left === right) return { size: 0, ratio: 0 }
  const shortest = Math.min(left.length, right.length)
  let prefix = 0
  while (prefix < shortest && left.charCodeAt(prefix) === right.charCodeAt(prefix)) prefix += 1

  let suffix = 0
  const remaining = shortest - prefix
  while (
    suffix < remaining &&
    left.charCodeAt(left.length - suffix - 1) === right.charCodeAt(right.length - suffix - 1)
  ) suffix += 1

  const removed = left.length - prefix - suffix
  const added = right.length - prefix - suffix
  const size = removed + added
  return {
    size,
    ratio: size / Math.max(1, left.length + right.length)
  }
}

function documentDifference(left: string, right: string): Difference & {
  plainSize: number
  structuralSize: number
} {
  const plain = difference(richTextPlainText(left), richTextPlainText(right))
  const structural = difference(left, right)
  return {
    size: Math.max(plain.size, Math.ceil(structural.size / 4)),
    ratio: Math.max(plain.ratio, structural.ratio),
    plainSize: plain.size,
    structuralSize: structural.size
  }
}

function elapsed(left: string, right: Date): number {
  const value = Date.parse(left)
  return Number.isFinite(value) ? Math.max(0, right.getTime() - value) : 0
}

function isMeaningful(change: ReturnType<typeof documentDifference>): boolean {
  return change.plainSize >= MEANINGFUL_SESSION_SIZE ||
    change.structuralSize >= MEANINGFUL_STRUCTURE_SIZE
}

function isLarge(change: ReturnType<typeof documentDifference>): boolean {
  return change.size >= LARGE_EDIT_SIZE ||
    (change.size >= LARGE_EDIT_RATIO_SIZE && change.ratio >= LARGE_EDIT_RATIO)
}

function isAccumulated(change: ReturnType<typeof documentDifference>): boolean {
  return change.size >= ACCUMULATED_EDIT_SIZE ||
    (change.size >= ACCUMULATED_RATIO_SIZE && change.ratio >= ACCUMULATED_EDIT_RATIO)
}

function isBlank(value: string): boolean {
  return richTextPlainText(value).trim().length === 0
}

/**
 * Bounded, write-path-owned recovery history.
 *
 * Every edit still increments the live field revision for synchronization, but
 * only this repository writes recovery snapshots. One mutable state row measures
 * current content against the last checkpoint, so many small autosaves can cross
 * a cumulative threshold without producing one history row per keystroke.
 */
export class RichTextHistoryRepository {
  constructor(private readonly database: SqliteAdapter) {}

  recordChange(
    reference: RichTextDocumentReference,
    current: RichTextDocumentSnapshot,
    nextValue: string,
    now = new Date()
  ): void {
    this.recordValueChange(reference, current, nextValue, now)
  }

  recordRestoration(
    reference: RichTextDocumentReference,
    current: RichTextDocumentSnapshot,
    nextValue: string,
    now = new Date()
  ): void {
    this.recordValueChange(reference, current, nextValue, now, 'restore')
  }

  /**
   * Records a rich-text field that does not expose a public synchronization
   * revision. The accumulator's baseline plus edit count is its durable,
   * internal history revision.
   */
  recordUnversionedChange(
    reference: Extract<RichTextHistoryReference, { type: 'routine-attestation' }>,
    currentValue: string,
    nextValue: string,
    now = new Date()
  ): void {
    this.recordValueChange(
      reference,
      this.unversionedCurrent(reference, currentValue, now),
      nextValue,
      now
    )
  }

  recordUnversionedRestoration(
    reference: Extract<RichTextHistoryReference, { type: 'routine-attestation' }>,
    currentValue: string,
    nextValue: string,
    now = new Date()
  ): void {
    this.recordValueChange(
      reference,
      this.unversionedCurrent(reference, currentValue, now),
      nextValue,
      now,
      'restore'
    )
  }

  private recordValueChange(
    reference: RichTextHistoryReference,
    current: Pick<RichTextDocumentSnapshot, 'value' | 'revision' | 'updatedAt'>,
    nextValue: string,
    now: Date,
    forcedReason: Extract<RichTextHistoryReason, 'restore'> | null = null
  ): void {
    if (current.value === nextValue) return
    if (Number.isNaN(now.getTime())) throw new TypeError('rich-text history requires a valid date')

    const type = documentType(reference)
    const state = this.state(reference)
    const baselineRevision = Number(state?.baseline_revision ?? current.revision)
    const baselineValue = state?.baseline_value ?? current.value
    const baselineAt = state?.baseline_at ?? current.updatedAt
    const lastEditAt = state?.last_edit_at ?? current.updatedAt
    const edits = Number(state?.edits_since_snapshot ?? 0) + 1
    const directChange = documentDifference(current.value, nextValue)
    const accumulatedChange = documentDifference(baselineValue, nextValue)
    const currentFromBaseline = documentDifference(baselineValue, current.value)
    const destructive = richTextPlainText(current.value).trim().length > 0 &&
      richTextPlainText(nextValue).trim().length === 0

    let reason: RichTextHistoryReason | null = forcedReason
    if (reason === null) {
      if (destructive) reason = 'destructive'
      else if (isLarge(directChange)) reason = 'large-edit'
      else if (
        edits > 1 &&
        elapsed(lastEditAt, now) >= RICH_TEXT_HISTORY_IDLE_MS &&
        isMeaningful(currentFromBaseline)
      ) reason = 'idle'
      else if (
        elapsed(baselineAt, now) >= RICH_TEXT_HISTORY_ELAPSED_MS &&
        isMeaningful(accumulatedChange)
      ) reason = 'elapsed'
      else if (isAccumulated(accumulatedChange)) reason = 'accumulated'
    }

    if (reason !== null && (forcedReason !== null || !isBlank(current.value))) {
      this.capture(
        reference,
        current.revision,
        current.value,
        now.toISOString(),
        reason,
        edits,
        reason === 'large-edit' || reason === 'destructive'
          ? directChange.size
          : accumulatedChange.size
      )
    }

    const reset = reason !== null
    if (state === undefined) {
      this.database.run(
        `INSERT INTO rich_text_history_state (
           document_type, entity_id, baseline_revision, baseline_value,
           baseline_at, last_edit_at, edits_since_snapshot, accumulated_change
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          type,
          reference.id,
          reset ? current.revision + 1 : baselineRevision,
          reset ? nextValue : baselineValue,
          reset ? now.toISOString() : baselineAt,
          now.toISOString(),
          reset ? 0 : edits,
          reset ? 0 : accumulatedChange.size
        ]
      )
    } else if (reset) {
      this.database.run(
        `UPDATE rich_text_history_state
         SET baseline_revision = ?, baseline_value = ?, baseline_at = ?,
             last_edit_at = ?, edits_since_snapshot = 0, accumulated_change = 0
         WHERE document_type = ? AND entity_id = ?`,
        [current.revision + 1, nextValue, now.toISOString(), now.toISOString(), type, reference.id]
      )
    } else {
      // The large baseline document stays untouched during ordinary autosaves.
      this.database.run(
        `UPDATE rich_text_history_state
         SET last_edit_at = ?, edits_since_snapshot = ?, accumulated_change = ?
         WHERE document_type = ? AND entity_id = ?`,
        [now.toISOString(), edits, accumulatedChange.size, type, reference.id]
      )
    }
  }

  list(reference: RichTextHistoryReference): RichTextHistorySnapshot[] {
    const type = documentType(reference)
    return this.database.all<HistoryRow>(
      `SELECT revision, value, changed_at, reason, edit_count, change_size
       FROM rich_text_history
       WHERE document_type = ? AND entity_id = ?
       ORDER BY revision DESC`,
      [type, reference.id]
    ).map((row) => ({
      reference: structuredClone(reference),
      revision: Number(row.revision),
      value: row.value,
      capturedAt: row.changed_at,
      reason: row.reason as RichTextHistoryReason,
      editCount: Number(row.edit_count),
      changeSize: Number(row.change_size)
    }))
  }

  require(reference: RichTextHistoryReference, revision: number): RichTextHistorySnapshot {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new ModelValidationError('rich-text history revision must be a non-negative integer')
    }
    const row = this.database.get<HistoryRow>(
      `SELECT revision, value, changed_at, reason, edit_count, change_size
       FROM rich_text_history
       WHERE document_type = ? AND entity_id = ? AND revision = ?`,
      [documentType(reference), reference.id, revision]
    )
    if (!row) throw new ModelNotFoundError('Rich-text history revision', revision)
    return {
      reference: structuredClone(reference),
      revision: Number(row.revision),
      value: row.value,
      capturedAt: row.changed_at,
      reason: row.reason as RichTextHistoryReason,
      editCount: Number(row.edit_count),
      changeSize: Number(row.change_size)
    }
  }

  private capture(
    reference: RichTextHistoryReference,
    revision: number,
    value: string,
    capturedAt: string,
    reason: RichTextHistoryReason,
    editCount: number,
    changeSize: number
  ): void {
    const type = documentType(reference)
    this.database.run(
      `INSERT OR IGNORE INTO rich_text_history (
         document_type, entity_id, revision, value, changed_at,
         reason, edit_count, change_size
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [type, reference.id, revision, value, capturedAt, reason, editCount, changeSize]
    )
    this.database.run(
      `DELETE FROM rich_text_history
       WHERE document_type = ? AND entity_id = ? AND revision NOT IN (
         SELECT revision FROM rich_text_history
         WHERE document_type = ? AND entity_id = ?
         ORDER BY revision DESC LIMIT ?
       )`,
      [type, reference.id, type, reference.id, RICH_TEXT_HISTORY_LIMIT]
    )
  }

  private state(reference: RichTextHistoryReference): HistoryStateRow | undefined {
    return this.database.get<HistoryStateRow>(
      `SELECT baseline_revision, baseline_value, baseline_at, last_edit_at,
              edits_since_snapshot, accumulated_change
       FROM rich_text_history_state
       WHERE document_type = ? AND entity_id = ?`,
      [documentType(reference), reference.id]
    )
  }

  private unversionedCurrent(
    reference: Extract<RichTextHistoryReference, { type: 'routine-attestation' }>,
    value: string,
    now: Date
  ): Pick<RichTextDocumentSnapshot, 'value' | 'revision' | 'updatedAt'> {
    const state = this.state(reference)
    const retainedRevision = state === undefined
      ? Number(this.database.get<{ revision: number | null }>(
          `SELECT max(revision) AS revision FROM rich_text_history
           WHERE document_type = ? AND entity_id = ?`,
          [documentType(reference), reference.id]
        )?.revision ?? -1)
      : -1
    return {
      value,
      revision: state === undefined
        ? retainedRevision + 1
        : Number(state.baseline_revision) + Number(state.edits_since_snapshot),
      updatedAt: state?.last_edit_at ?? now.toISOString()
    }
  }
}
