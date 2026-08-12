import type {
  RichTextDocumentReference,
  RichTextDocumentSnapshot
} from '../../shared/contracts'
import { ModelNotFoundError, ModelValidationError } from './model'
import type { SqliteAdapter } from './sqlite-adapter'

interface RichTextRow {
  value: string | null
  revision: number
  updated_at: string
  owner_title: string
  document_title: string | null
  focus_title: string | null
  thread_title: string | null
  commitment_title: string | null
}

function assertReference(reference: RichTextDocumentReference): void {
  if (!reference || !Number.isSafeInteger(reference.id) || reference.id <= 0) {
    throw new ModelValidationError('rich-text document id must be a positive integer')
  }
  const valid =
    (reference.type === 'focus' && ['goal', 'description'].includes(reference.field)) ||
    (reference.type === 'update' && reference.field === 'observation') ||
    (reference.type === 'note' && reference.field === 'content')
  if (!valid) throw new ModelValidationError('unsupported rich-text document reference')
}

function timestamp(now = new Date()): string {
  return now.toISOString()
}

function referenceTitle(reference: RichTextDocumentReference, row: RichTextRow): string {
  if (reference.type === 'focus') {
    return `${row.owner_title} — ${reference.field === 'goal' ? 'Goal' : 'Description'}`
  }
  if (reference.type === 'update') return `${row.owner_title} — Update`
  return `${row.owner_title} — ${row.document_title ?? 'Note'}`
}

function hierarchyPath(row: RichTextRow): string[] {
  if (row.commitment_title) {
    return [
      row.focus_title ?? row.owner_title,
      row.thread_title ?? 'Overall',
      row.commitment_title
    ]
  }
  if (row.thread_title) {
    return [row.focus_title ?? row.owner_title, row.thread_title]
  }
  if (row.focus_title) return ['Portfolio', row.focus_title]
  return [row.owner_title]
}

function referenceContextPath(
  reference: RichTextDocumentReference,
  row: RichTextRow
): string[] {
  const leaf = reference.type === 'focus'
    ? (reference.field === 'goal' ? 'Goal' : 'Description')
    : reference.type === 'update'
      ? 'Update'
      : (row.document_title ?? 'Note')
  return [...hierarchyPath(row), leaf]
}

/**
 * One main-process persistence path for every rich-text editor. DatabaseSync and
 * the Electron main event loop serialize commits from all renderer windows.
 */
export class RichTextDocumentRepository {
  constructor(private readonly database: SqliteAdapter) {}

  get(reference: RichTextDocumentReference): RichTextDocumentSnapshot {
    assertReference(reference)
    const row = this.row(reference)
    if (!row) throw new ModelNotFoundError('Rich-text document', reference.id)
    return {
      reference: structuredClone(reference),
      title: referenceTitle(reference, row),
      contextPath: referenceContextPath(reference, row),
      value: row.value ?? '',
      revision: Number(row.revision),
      updatedAt: row.updated_at
    }
  }

  save(
    reference: RichTextDocumentReference,
    value: string,
    now = new Date()
  ): RichTextDocumentSnapshot {
    assertReference(reference)
    if (typeof value !== 'string') {
      throw new ModelValidationError('rich-text document value must be text')
    }

    return this.database.transaction(() => {
      const current = this.get(reference)
      if (current.value === value) return current
      const changedAt = timestamp(now)
      let result: { changes: number }
      if (reference.type === 'focus') {
        const column = reference.field === 'goal' ? 'goal' : 'description'
        result = this.database.run(
          `UPDATE focuses SET ${column} = ?, updated_at = ? WHERE id = ?`,
          [value, changedAt, reference.id]
        )
      } else if (reference.type === 'update') {
        result = this.database.run(
          'UPDATE updates SET observation = ?, updated_at = ? WHERE id = ?',
          [value, changedAt, reference.id]
        )
      } else {
        result = this.database.run(
          'UPDATE notes SET content = ?, updated_at = ? WHERE id = ?',
          [value, changedAt, reference.id]
        )
      }
      if (result.changes === 0) {
        throw new ModelNotFoundError('Rich-text document', reference.id)
      }
      return this.get(reference)
    })
  }

  private row(reference: RichTextDocumentReference): RichTextRow | undefined {
    if (reference.type === 'focus') {
      const valueColumn = reference.field === 'goal' ? 'goal' : 'description'
      const revisionColumn = reference.field === 'goal'
        ? 'goal_revision'
        : 'description_revision'
      return this.database.get<RichTextRow>(
        `SELECT ${valueColumn} AS value, ${revisionColumn} AS revision,
                updated_at, title AS owner_title, NULL AS document_title,
                title AS focus_title, NULL AS thread_title, NULL AS commitment_title
         FROM focuses WHERE id = ?`,
        [reference.id]
      )
    }
    if (reference.type === 'update') {
      return this.database.get<RichTextRow>(
        `SELECT update_record.observation AS value,
                update_record.observation_revision AS revision,
                update_record.updated_at,
                COALESCE(focus.title, thread.title, commitment.title, 'Update') AS owner_title,
                NULL AS document_title,
                COALESCE(
                  focus.title, thread_focus.title, commitment_focus.title,
                  commitment_thread_focus.title
                ) AS focus_title,
                COALESCE(thread.title, commitment_thread.title) AS thread_title,
                commitment.title AS commitment_title
         FROM updates update_record
         LEFT JOIN focuses focus ON focus.id = update_record.focus_id
         LEFT JOIN threads thread ON thread.id = update_record.thread_id
         LEFT JOIN focuses thread_focus ON thread_focus.id = thread.focus_id
         LEFT JOIN commitments commitment ON commitment.id = update_record.commitment_id
         LEFT JOIN focuses commitment_focus ON commitment_focus.id = commitment.focus_id
         LEFT JOIN threads commitment_thread ON commitment_thread.id = commitment.thread_id
         LEFT JOIN focuses commitment_thread_focus
           ON commitment_thread_focus.id = commitment_thread.focus_id
         WHERE update_record.id = ?`,
        [reference.id]
      )
    }
    return this.database.get<RichTextRow>(
      `SELECT note.content AS value, note.content_revision AS revision, note.updated_at,
              COALESCE(focus.title, thread.title, commitment.title, 'Note') AS owner_title,
              note.title AS document_title,
              COALESCE(
                focus.title, thread_focus.title, commitment_focus.title,
                commitment_thread_focus.title
              ) AS focus_title,
              COALESCE(thread.title, commitment_thread.title) AS thread_title,
              commitment.title AS commitment_title
       FROM notes note
       LEFT JOIN focuses focus ON focus.id = note.focus_id
       LEFT JOIN threads thread ON thread.id = note.thread_id
       LEFT JOIN focuses thread_focus ON thread_focus.id = thread.focus_id
       LEFT JOIN commitments commitment ON commitment.id = note.commitment_id
       LEFT JOIN focuses commitment_focus ON commitment_focus.id = commitment.focus_id
       LEFT JOIN threads commitment_thread ON commitment_thread.id = commitment.thread_id
       LEFT JOIN focuses commitment_thread_focus
         ON commitment_thread_focus.id = commitment_thread.focus_id
       WHERE note.id = ?`,
      [reference.id]
    )
  }
}
