import type { NoteParent, NoteSnapshot } from '../../shared/contracts'
import { BaseModel, BaseRepository, ModelValidationError } from './model'
import type { SqliteAdapter } from './sqlite-adapter'

type NoteRecord = NoteSnapshot

interface NoteRow {
  id: number
  focus_id: number | null
  thread_id: number | null
  commitment_id: number | null
  title: string
  content: string
  content_revision: number
  sort_key: number
  created_at: string
  updated_at: string
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ModelValidationError('note id must be a positive integer')
  }
}

function parentColumn(parent: NoteParent): 'focus_id' | 'thread_id' | 'commitment_id' {
  assertId(parent.id)
  if (parent.type === 'focus') return 'focus_id'
  if (parent.type === 'thread') return 'thread_id'
  return 'commitment_id'
}

function fromRow(row: NoteRow): NoteRecord {
  const parent: NoteParent = row.focus_id !== null
    ? { type: 'focus', id: Number(row.focus_id) }
    : row.thread_id !== null
      ? { type: 'thread', id: Number(row.thread_id) }
      : { type: 'commitment', id: Number(row.commitment_id) }
  return {
    id: Number(row.id),
    parent,
    title: row.title,
    content: row.content,
    revision: Number(row.content_revision),
    sort: Number(row.sort_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const NOTE_COLUMNS = `id, focus_id, thread_id, commitment_id, title, content,
  content_revision, sort_key, created_at, updated_at`

export class NoteModel extends BaseModel<NoteRecord> {
  constructor(repository: NoteRepository, record: NoteRecord) {
    super(repository, record)
  }

  toSnapshot(): NoteSnapshot {
    return structuredClone(this.record)
  }
}

/** Notes are aggregate children; current creation is intentionally owned by DB triggers. */
export class NoteRepository extends BaseRepository<NoteRecord, NoteModel> {
  constructor(private readonly database: SqliteAdapter) {
    super()
  }

  protected instantiate(record: NoteRecord): NoteModel {
    return new NoteModel(this, record)
  }

  find(id: number): NoteRecord | null {
    assertId(id)
    const row = this.database.get<NoteRow>(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`,
      [id]
    )
    return row ? fromRow(row) : null
  }

  list(parent: NoteParent): NoteSnapshot[] {
    const column = parentColumn(parent)
    return this.database
      .all<NoteRow>(
        `SELECT ${NOTE_COLUMNS} FROM notes WHERE ${column} = ? ORDER BY sort_key, id`,
        [parent.id]
      )
      .map(fromRow)
  }

  delete(id: number): boolean {
    assertId(id)
    return this.database.run('DELETE FROM notes WHERE id = ?', [id]).changes > 0
  }
}
