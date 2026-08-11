import type {
  SubjectSnapshot,
  TagSummarySnapshot,
  TagUseContextSnapshot,
  TagUseSnapshot,
  TagUseSource
} from '../../shared/contracts'
import { richTextPlainText } from '../../shared/rich-text-value'
import { findTextTags, type TextTagMatch } from '../../shared/text-tags'
import { ModelValidationError } from './model'
import type { SqliteAdapter } from './sqlite-adapter'

interface HierarchyRow {
  focus_id: number
  focus_title: string
  focus_sensitive: number
  thread_id: number | null
  thread_title: string | null
  thread_sensitive: number | null
  commitment_id: number | null
  commitment_title: string | null
  commitment_sensitive: number | null
  subject_id: number | null
  subject_kind: string | null
  subject_name: string | null
  subject_description: string | null
  subject_external_key: string | null
  subject_sensitive: number | null
  subject_created_at: string | null
  subject_updated_at: string | null
  scope_sensitive: number | null
}

interface FocusTextRow {
  id: number
  title: string
  description: string | null
  goal: string
  sensitive: number
}

interface ThreadTextRow extends HierarchyRow {
  id: number
  title: string
  sensitive: number
}

interface CommitmentTextRow extends HierarchyRow {
  id: number
  title: string
  sensitive: number
}

interface UpdateTextRow extends HierarchyRow {
  id: number
  observation: string
  sensitive: number
}

interface TodoTextRow extends HierarchyRow {
  id: number
  name: string
}

interface NoteTextRow extends HierarchyRow {
  id: number
  title: string
  content: string
}

interface TaggableRecord {
  source: TagUseSource
  value: string
  richText: boolean
  context: TagUseContextSnapshot
  effectiveSensitive: boolean
}

const HIERARCHY_COLUMNS = `
  focus.id AS focus_id,
  focus.title AS focus_title,
  focus.sensitive AS focus_sensitive,
  direct_thread.id AS thread_id,
  direct_thread.title AS thread_title,
  direct_thread.sensitive AS thread_sensitive,
  commitment.id AS commitment_id,
  commitment.title AS commitment_title,
  commitment.sensitive AS commitment_sensitive,
  subject.id AS subject_id,
  subject.kind AS subject_kind,
  subject.name AS subject_name,
  subject.description AS subject_description,
  subject.external_key AS subject_external_key,
  subject.sensitive AS subject_sensitive,
  subject.created_at AS subject_created_at,
  subject.updated_at AS subject_updated_at,
  scope.sensitive AS scope_sensitive`

function subjectFromRow(row: HierarchyRow): SubjectSnapshot | null {
  if (row.subject_id === null) return null
  return {
    id: Number(row.subject_id),
    kind: row.subject_kind as string,
    name: row.subject_name as string,
    description: row.subject_description,
    externalKey: row.subject_external_key,
    sensitive: Boolean(row.subject_sensitive),
    createdAt: row.subject_created_at as string,
    updatedAt: row.subject_updated_at as string
  }
}

function contextFromRow(row: HierarchyRow): TagUseContextSnapshot {
  return {
    focus: {
      id: Number(row.focus_id),
      title: row.focus_title,
      sensitive: Boolean(row.focus_sensitive)
    },
    thread: row.thread_id === null
      ? null
      : {
          id: Number(row.thread_id),
          title: row.thread_title as string,
          sensitive: Boolean(row.thread_sensitive)
        },
    commitment: row.commitment_id === null
      ? null
      : {
          id: Number(row.commitment_id),
          title: row.commitment_title as string,
          sensitive: Boolean(row.commitment_sensitive)
        },
    subject: subjectFromRow(row)
  }
}

function hierarchySensitive(row: HierarchyRow, sourceSensitive = false): boolean {
  return sourceSensitive || [
    row.focus_sensitive,
    row.thread_sensitive,
    row.commitment_sensitive,
    row.subject_sensitive,
    row.scope_sensitive
  ].some(Boolean)
}

function assertTagName(name: string): void {
  if (typeof name !== 'string' || name.length === 0 || name.trim() !== name) {
    throw new ModelValidationError('tag name must be a non-empty alphanumeric identifier')
  }
  const matches = findTextTags(`@${name}`)
  if (matches.length !== 1 || matches[0].name !== name || matches[0].value !== `@${name}`) {
    throw new ModelValidationError('tag name must contain only Unicode letters and numbers')
  }
}

function normalizedPlainText(record: TaggableRecord): string {
  const value = record.richText ? richTextPlainText(record.value) : record.value
  return value.replace(/\s+/gu, ' ').trim()
}

function tagSnippet(value: string, match: TextTagMatch, maximumLength = 180): string {
  const before = Array.from(value.slice(0, match.start))
  const token = Array.from(value.slice(match.start, match.end))
  const after = Array.from(value.slice(match.end))
  const contextBudget = Math.max(0, maximumLength - token.length)
  let beforeLength = Math.min(before.length, Math.floor(contextBudget / 2))
  const afterLength = Math.min(after.length, contextBudget - beforeLength)
  beforeLength = Math.min(before.length, contextBudget - afterLength)

  const leading = before.length > beforeLength ? '…' : ''
  const trailing = after.length > afterLength ? '…' : ''
  return `${leading}${before.slice(-beforeLength).join('')}${token.join('')}${after
    .slice(0, afterLength).join('')}${trailing}`.trim()
}

/**
 * Read-only derived tag index. Literal stored text remains the sole source of
 * truth, so imports, moves, edits, and cascade deletions need no index repair.
 */
export class TagRepository {
  constructor(private readonly database: SqliteAdapter) {}

  list(): TagSummarySnapshot[] {
    const summaries = new Map<string, TagSummarySnapshot>()
    for (const use of this.projectUses()) {
      const current = summaries.get(use.name) ?? {
        name: use.name,
        useCount: 0,
        sensitiveUseCount: 0
      }
      current.useCount += 1
      if (use.effectiveSensitive) current.sensitiveUseCount += 1
      summaries.set(use.name, current)
    }
    return [...summaries.values()].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }) ||
      left.name.localeCompare(right.name)
    )
  }

  uses(name: string): TagUseSnapshot[] {
    assertTagName(name)
    return this.projectUses(name)
  }

  private projectUses(onlyName?: string): TagUseSnapshot[] {
    const uses: TagUseSnapshot[] = []
    for (const record of this.records()) {
      const plainText = normalizedPlainText(record)
      let occurrence = 0
      for (const match of findTextTags(plainText)) {
        if (onlyName !== undefined && match.name !== onlyName) continue
        uses.push({
          id: `${record.source.type}:${record.source.id}:${record.source.field}:${occurrence}`,
          name: match.name,
          source: structuredClone(record.source),
          context: structuredClone(record.context),
          snippet: tagSnippet(plainText, match),
          effectiveSensitive: record.effectiveSensitive
        })
        occurrence += 1
      }
    }
    return uses
  }

  private records(): TaggableRecord[] {
    return [
      ...this.focusRecords(),
      ...this.threadRecords(),
      ...this.commitmentRecords(),
      ...this.updateRecords(),
      ...this.todoRecords(),
      ...this.noteRecords()
    ]
  }

  private focusRecords(): TaggableRecord[] {
    return this.database.all<FocusTextRow>(
      'SELECT id, title, description, goal, sensitive FROM focuses ORDER BY id'
    ).flatMap((row) => {
      const context: TagUseContextSnapshot = {
        focus: { id: Number(row.id), title: row.title, sensitive: Boolean(row.sensitive) },
        thread: null,
        commitment: null,
        subject: null
      }
      const base = { context, effectiveSensitive: Boolean(row.sensitive) }
      return [
        { ...base, source: { type: 'focus', id: Number(row.id), field: 'title' }, value: row.title, richText: false },
        { ...base, source: { type: 'focus', id: Number(row.id), field: 'description' }, value: row.description ?? '', richText: true },
        { ...base, source: { type: 'focus', id: Number(row.id), field: 'goal' }, value: row.goal, richText: true }
      ] satisfies TaggableRecord[]
    })
  }

  private threadRecords(): TaggableRecord[] {
    return this.database.all<ThreadTextRow>(
      `SELECT thread.id, thread.title, thread.sensitive, ${HIERARCHY_COLUMNS}
       FROM threads thread
       JOIN focuses focus ON focus.id = thread.focus_id
       LEFT JOIN threads direct_thread ON direct_thread.id = thread.id
       LEFT JOIN commitments commitment ON 0
       LEFT JOIN subjects subject ON 0
       LEFT JOIN scopes scope ON 0
       ORDER BY thread.id`
    ).map((row) => ({
      source: { type: 'thread', id: Number(row.id), field: 'title' },
      value: row.title,
      richText: false,
      context: contextFromRow(row),
      effectiveSensitive: hierarchySensitive(row, Boolean(row.sensitive))
    }))
  }

  private commitmentRecords(): TaggableRecord[] {
    return this.database.all<CommitmentTextRow>(
      `SELECT commitment.id, commitment.title, commitment.sensitive, ${HIERARCHY_COLUMNS}
       FROM commitments commitment
       LEFT JOIN threads direct_thread ON direct_thread.id = commitment.thread_id
       JOIN focuses focus ON focus.id = COALESCE(commitment.focus_id, direct_thread.focus_id)
       LEFT JOIN subjects subject ON 0
       LEFT JOIN scopes scope ON 0
       ORDER BY commitment.id`
    ).map((row) => ({
      source: { type: 'commitment', id: Number(row.id), field: 'title' },
      value: row.title,
      richText: false,
      context: contextFromRow(row),
      effectiveSensitive: hierarchySensitive(row, Boolean(row.sensitive))
    }))
  }

  private updateRecords(): TaggableRecord[] {
    return this.database.all<UpdateTextRow>(
      `SELECT update_record.id, update_record.observation, update_record.sensitive,
              ${HIERARCHY_COLUMNS}
       FROM updates update_record
       LEFT JOIN commitments commitment ON commitment.id = update_record.commitment_id
       LEFT JOIN threads direct_update_thread ON direct_update_thread.id = update_record.thread_id
       LEFT JOIN threads direct_thread ON direct_thread.id = COALESCE(
         update_record.thread_id, commitment.thread_id
       )
       JOIN focuses focus ON focus.id = COALESCE(
         update_record.focus_id, direct_update_thread.focus_id,
         commitment.focus_id, direct_thread.focus_id
       )
       LEFT JOIN subjects subject ON subject.id = update_record.subject_id
       LEFT JOIN scopes scope ON scope.id = update_record.scope_id
       ORDER BY update_record.id`
    ).map((row) => ({
      source: { type: 'update', id: Number(row.id), field: 'observation' },
      value: row.observation,
      richText: true,
      context: contextFromRow(row),
      effectiveSensitive: hierarchySensitive(row, Boolean(row.sensitive))
    }))
  }

  private todoRecords(): TaggableRecord[] {
    return this.database.all<TodoTextRow>(
      `SELECT todo.id, todo.name, ${HIERARCHY_COLUMNS}
       FROM todos todo
       LEFT JOIN commitments commitment ON commitment.id = todo.commitment_id
       LEFT JOIN threads direct_todo_thread ON direct_todo_thread.id = todo.thread_id
       LEFT JOIN threads direct_thread ON direct_thread.id = COALESCE(todo.thread_id, commitment.thread_id)
       JOIN focuses focus ON focus.id = COALESCE(
         todo.focus_id, direct_todo_thread.focus_id, commitment.focus_id, direct_thread.focus_id
       )
       LEFT JOIN subjects subject ON subject.id = todo.subject_id
       LEFT JOIN scopes scope ON scope.id = todo.scope_id
       ORDER BY todo.id`
    ).map((row) => ({
      source: { type: 'todo', id: Number(row.id), field: 'name' },
      value: row.name,
      richText: false,
      context: contextFromRow(row),
      effectiveSensitive: hierarchySensitive(row)
    }))
  }

  private noteRecords(): TaggableRecord[] {
    return this.database.all<NoteTextRow>(
      `SELECT note.id, note.title, note.content, ${HIERARCHY_COLUMNS}
       FROM notes note
       LEFT JOIN commitments commitment ON commitment.id = note.commitment_id
       LEFT JOIN threads direct_note_thread ON direct_note_thread.id = note.thread_id
       LEFT JOIN threads direct_thread ON direct_thread.id = COALESCE(note.thread_id, commitment.thread_id)
       JOIN focuses focus ON focus.id = COALESCE(
         note.focus_id, direct_note_thread.focus_id, commitment.focus_id, direct_thread.focus_id
       )
       LEFT JOIN subjects subject ON 0
       LEFT JOIN scopes scope ON 0
       ORDER BY note.id`
    ).flatMap((row) => {
      const base = {
        context: contextFromRow(row),
        effectiveSensitive: hierarchySensitive(row)
      }
      return [
        { ...base, source: { type: 'note', id: Number(row.id), field: 'title' }, value: row.title, richText: false },
        { ...base, source: { type: 'note', id: Number(row.id), field: 'content' }, value: row.content, richText: true }
      ] satisfies TaggableRecord[]
    })
  }
}
