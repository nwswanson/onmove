import { richTextPlainText } from '../../shared/rich-text-value'
import type { OnMoveAccessPolicy } from './access-policy'
import type { SqlValue, SqliteAdapter } from '../data/sqlite-adapter'

export const SEARCH_ENTITY_TYPES = [
  'focus',
  'thread',
  'commitment',
  'routine',
  'update',
  'todo',
  'note',
  'subject'
] as const
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number]

export interface SearchQuery {
  text: string
  kinds?: readonly SearchEntityType[]
  /** Null and omission are both explicitly global; callers must opt into narrowing. */
  focusId?: number | null
  subjectId?: number | null
  limit?: number
  offset?: number
}

export interface SearchHierarchyReference {
  focus: { id: number; title: string } | null
  thread: { id: number; title: string } | null
  commitment: { id: number; title: string } | null
}

export interface SearchResult {
  reference: { type: SearchEntityType; id: number }
  uri: string
  field: string
  title: string
  contextPath: string[]
  /** Self-describing owner IDs for safe follow-up get_focus/get_thread/get_commitment calls. */
  hierarchy: SearchHierarchyReference
  subject: { id: number; name: string } | null
  snippet: string
  rank: number
  effectiveSensitive: boolean
  updatedAt: string
}

interface IndexSourceRow {
  id: number
  title: string
  body: string | null
  field_name: string
  focus_id: number | null
  thread_id: number | null
  commitment_id: number | null
  subject_id: number | null
  scope_id: number | null
  direct_sensitive: number
  status: string | null
  state: string | null
  due_on: string | null
  updated_at: string
}

interface SearchRow {
  entity_type: SearchEntityType
  entity_id: number
  field_name: string
  title: string
  focus_id: number | null
  focus_title: string | null
  thread_id: number | null
  thread_title: string | null
  commitment_id: number | null
  commitment_title: string | null
  subject_id: number | null
  subject_name: string | null
  snippet: string
  rank: number
  effective_sensitive: number
  updated_at: string
}

function plainText(value: string | null): string {
  return richTextPlainText(value ?? '').replace(/\s+/gu, ' ').trim()
}

function sourceKey(type: SearchEntityType, id: number, field: string): string {
  return `${type}:${id}:${field}`
}

function resourceUri(type: SearchEntityType, id: number): string {
  if (type === 'update' || type === 'todo' || type === 'note') return `onmove://${type}/${id}`
  return `onmove://${type}/${id}`
}

function ftsExpression(text: string): string {
  const tokens = text.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) ?? []
  const unique = [...new Set(tokens.map((token) => token.toLocaleLowerCase()))].slice(0, 24)
  if (unique.length === 0) throw new TypeError('search text must contain letters or numbers')
  return unique.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' OR ')
}

/** Durable, migration-backed FTS5 projection over every user-authored text surface. */
export class SearchIndexRepository {
  constructor(private readonly database: SqliteAdapter) {}

  synchronize(now = new Date()): boolean {
    const dirty = this.database.get<{ dirty: number }>(
      'SELECT dirty FROM search_index_state WHERE singleton = 1'
    )
    if (!dirty || dirty.dirty === 0) return false

    this.database.transaction(() => {
      this.database.run('DELETE FROM search_documents')
      this.insertRows('focus', this.focusRows())
      this.insertRows('thread', this.threadRows())
      const commitments = this.commitmentRows()
      this.insertRows('commitment', commitments.filter(({ field_name }) => field_name !== 'routine'))
      this.insertRows('routine', commitments.filter(({ field_name }) => field_name === 'routine'))
      this.insertRows('update', this.updateRows())
      this.insertRows('todo', this.todoRows())
      this.insertRows('note', this.noteRows())
      this.insertRows('subject', this.subjectRows())
      this.database.run(
        'UPDATE search_index_state SET dirty = 0, indexed_at = ? WHERE singleton = 1',
        [now.toISOString()]
      )
    })
    return true
  }

  search(query: SearchQuery, access: OnMoveAccessPolicy): SearchResult[] {
    if (typeof query.text !== 'string' || query.text.trim().length === 0) {
      throw new TypeError('search text cannot be empty')
    }
    const limit = query.limit ?? 25
    const offset = query.offset ?? 0
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('search limit must be between 1 and 100')
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
      throw new TypeError('search offset must be between 0 and 10000')
    }
    const kinds = query.kinds ?? []
    if (kinds.some((kind) => !SEARCH_ENTITY_TYPES.includes(kind))) {
      throw new TypeError('search kinds contain an unsupported entity type')
    }
    this.synchronize()

    const conditions = ['search_documents_fts MATCH ?']
    const parameters: SqlValue[] = [ftsExpression(query.text)]
    if (kinds.length > 0) {
      conditions.push(`document.entity_type IN (${kinds.map(() => '?').join(', ')})`)
      parameters.push(...kinds)
    }
    if (query.focusId !== undefined && query.focusId !== null) {
      conditions.push('document.focus_id = ?')
      parameters.push(query.focusId)
    }
    if (query.subjectId !== undefined && query.subjectId !== null) {
      conditions.push('document.subject_id = ?')
      parameters.push(query.subjectId)
    }
    const sensitivity = `MAX(
      document.direct_sensitive,
      COALESCE(focus.sensitive, 0), COALESCE(thread.sensitive, 0),
      COALESCE(commitment.sensitive, 0), COALESCE(subject.sensitive, 0),
      COALESCE(scope.sensitive, 0)
    )`
    if (access.sensitiveContent === 'deny') conditions.push(`${sensitivity} = 0`)
    parameters.push(limit, offset)

    return this.database.all<SearchRow>(
      `SELECT document.entity_type, document.entity_id, document.field_name, document.title,
              document.focus_id, focus.title AS focus_title,
              document.thread_id, thread.title AS thread_title,
              document.commitment_id, commitment.title AS commitment_title,
              document.subject_id, subject.name AS subject_name,
              snippet(search_documents_fts, 1, '', '', ' … ', 24) AS snippet,
              bm25(search_documents_fts, 4.0, 1.0) AS rank,
              ${sensitivity} AS effective_sensitive,
              document.updated_at
       FROM search_documents_fts
       JOIN search_documents document ON document.id = search_documents_fts.rowid
       LEFT JOIN focuses focus ON focus.id = document.focus_id
       LEFT JOIN threads thread ON thread.id = document.thread_id
       LEFT JOIN commitments commitment ON commitment.id = document.commitment_id
       LEFT JOIN subjects subject ON subject.id = document.subject_id
       LEFT JOIN scopes scope ON scope.id = document.scope_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY rank, document.updated_at DESC, document.id
       LIMIT ? OFFSET ?`,
      parameters
    ).map((row) => ({
      reference: { type: row.entity_type, id: Number(row.entity_id) },
      uri: resourceUri(row.entity_type, Number(row.entity_id)),
      field: row.field_name === 'routine' ? 'template' : row.field_name,
      title: row.title,
      contextPath: [row.focus_title, row.thread_title, row.commitment_title]
        .filter((value): value is string => Boolean(value)),
      hierarchy: {
        focus: row.focus_id === null
          ? null
          : { id: Number(row.focus_id), title: row.focus_title as string },
        thread: row.thread_id === null
          ? null
          : { id: Number(row.thread_id), title: row.thread_title as string },
        commitment: row.commitment_id === null
          ? null
          : { id: Number(row.commitment_id), title: row.commitment_title as string }
      },
      subject: row.subject_id === null
        ? null
        : { id: Number(row.subject_id), name: row.subject_name as string },
      snippet: plainText(row.snippet),
      rank: Number(row.rank),
      effectiveSensitive: Boolean(row.effective_sensitive),
      updatedAt: row.updated_at
    }))
  }

  private insertRows(type: SearchEntityType, rows: readonly IndexSourceRow[]): void {
    for (const row of rows) {
      const field = row.field_name === 'routine' ? 'template' : row.field_name
      this.database.run(
        `INSERT INTO search_documents (
           source_key, entity_type, entity_id, field_name, title, body,
           focus_id, thread_id, commitment_id, subject_id, scope_id,
           direct_sensitive, status, state, due_on, review_due, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [
          sourceKey(type, Number(row.id), field), type, Number(row.id), field,
          row.title, plainText(row.body), row.focus_id, row.thread_id,
          row.commitment_id, row.subject_id, row.scope_id,
          row.direct_sensitive, row.status, row.state, row.due_on, row.updated_at
        ]
      )
    }
  }

  private focusRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT id, title, description AS body, 'overview' AS field_name,
              id AS focus_id, NULL AS thread_id, NULL AS commitment_id,
              NULL AS subject_id, NULL AS scope_id, sensitive AS direct_sensitive,
              status, NULL AS state, due_on, updated_at
       FROM focuses`
    )
  }

  private threadRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT thread.id, thread.title, '' AS body, 'title' AS field_name,
              thread.focus_id, thread.id AS thread_id, NULL AS commitment_id,
              NULL AS subject_id, application.scope_id,
              thread.sensitive AS direct_sensitive, thread.status,
              NULL AS state, thread.due_on, thread.updated_at
       FROM threads thread
       LEFT JOIN thread_scope_applications application ON application.thread_id = thread.id`
    )
  }

  private commitmentRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT commitment.id, commitment.title,
              CASE WHEN commitment.behavior_type = 'routine' THEN COALESCE((
                SELECT group_concat(item.inspection, char(10))
                FROM routine_definitions definition
                JOIN routine_template_versions version
                  ON version.routine_id = definition.commitment_id
                 AND version.version = definition.current_template_version
                JOIN routine_template_items item ON item.template_version_id = version.id
                WHERE definition.commitment_id = commitment.id
                ORDER BY item.position
              ), '') ELSE '' END AS body,
              CASE WHEN commitment.behavior_type = 'routine' THEN 'routine' ELSE 'title' END AS field_name,
              thread.focus_id, thread.id AS thread_id, commitment.id AS commitment_id,
              NULL AS subject_id, application.scope_id,
              commitment.sensitive AS direct_sensitive, commitment.status,
              NULL AS state, commitment.due_on, commitment.updated_at
       FROM commitments commitment
       JOIN threads thread ON thread.id = commitment.thread_id
       LEFT JOIN commitment_scope_applications application
         ON application.commitment_id = commitment.id`
    )
  }

  private updateRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT update_record.id,
              CASE WHEN commitment.id IS NULL THEN thread.title ELSE commitment.title END AS title,
              update_record.observation AS body, 'observation' AS field_name,
              thread.focus_id, thread.id AS thread_id, commitment.id AS commitment_id,
              update_record.subject_id, update_record.scope_id,
              update_record.sensitive AS direct_sensitive, NULL AS status,
              update_record.state, NULL AS due_on, update_record.updated_at
       FROM updates update_record
       LEFT JOIN commitments commitment ON commitment.id = update_record.commitment_id
       JOIN threads thread ON thread.id = COALESCE(update_record.thread_id, commitment.thread_id)`
    )
  }

  private todoRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT todo.id, todo.name AS title, todo.name AS body, 'name' AS field_name,
              thread.focus_id, thread.id AS thread_id, commitment.id AS commitment_id,
              todo.subject_id, todo.scope_id, 0 AS direct_sensitive,
              CASE WHEN todo.done = 1 THEN 'done' ELSE 'active' END AS status,
              NULL AS state, todo.due_on, todo.updated_at
       FROM todos todo
       LEFT JOIN commitments commitment ON commitment.id = todo.commitment_id
       JOIN threads thread ON thread.id = COALESCE(todo.thread_id, commitment.thread_id)`
    )
  }

  private noteRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT note.id, note.title, note.content AS body, 'content' AS field_name,
              focus.id AS focus_id, thread.id AS thread_id, commitment.id AS commitment_id,
              NULL AS subject_id, NULL AS scope_id, 0 AS direct_sensitive,
              NULL AS status, NULL AS state, NULL AS due_on, note.updated_at
       FROM notes note
       LEFT JOIN commitments commitment ON commitment.id = note.commitment_id
       LEFT JOIN threads thread ON thread.id = COALESCE(note.thread_id, commitment.thread_id)
       JOIN focuses focus ON focus.id = COALESCE(note.focus_id, thread.focus_id)`
    )
  }

  private subjectRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT id, name AS title, description AS body, 'profile' AS field_name,
              NULL AS focus_id, NULL AS thread_id, NULL AS commitment_id,
              id AS subject_id, NULL AS scope_id, sensitive AS direct_sensitive,
              NULL AS status, NULL AS state, NULL AS due_on, updated_at
       FROM subjects`
    )
  }
}
