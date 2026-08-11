import { LATEST_SCHEMA_VERSION } from './migrations'
import type { SqlValue, SqliteAdapter } from './sqlite-adapter'

export const DATA_ARCHIVE_FORMAT = 'onmove-data'
export const DATA_ARCHIVE_VERSION = 1

/**
 * Parent tables precede their dependants. The format deliberately stores raw,
 * named fields: an older app can ignore future columns and a newer app can use
 * SQLite defaults for columns absent from an older archive.
 */
export const DATA_ARCHIVE_TABLES = [
  'relations',
  'items',
  'focuses',
  'threads',
  'commitments',
  'subjects',
  'scopes',
  'scope_memberships',
  'focus_scope_applications',
  'thread_scope_applications',
  'commitment_scope_applications',
  'updates',
  'todos',
  'todo_subject_completions',
  'todo_lists',
  'todo_sort_placements',
  'notes',
  'status_transitions',
  'focus_status_transitions',
  'thread_status_transitions',
  'commitment_status_transitions',
  'commitment_parent_transitions',
  'scope_application_transitions',
  'rich_text_history'
] as const

type ArchiveTable = (typeof DATA_ARCHIVE_TABLES)[number]
type ArchiveRow = Record<string, unknown>

export interface DataArchive {
  format: typeof DATA_ARCHIVE_FORMAT
  archiveVersion: number
  schemaVersion: number
  appVersion: string
  exportedAt: string
  tables: Record<ArchiveTable, ArchiveRow[]>
}

export interface DataImportSummary {
  sourceArchiveVersion: number | null
  sourceSchemaVersion: number | null
  candidateRows: number
  importedRows: number
  skippedRows: number
  repairedRows: number
  ignoredTables: string[]
  ignoredFields: string[]
  issues: Array<{ table: string; row: number; message: string }>
}

interface TableColumn {
  name: string
  type: string
}

interface TriggerRow {
  name: string
  sql: string
}

interface ForeignKeyViolation {
  table: string
  rowid: number | null
}

const TABLE_SET = new Set<string>(DATA_ARCHIVE_TABLES)
const BOOLEAN_COLUMNS = new Set([
  'sensitive',
  'needs_review',
  'done',
  'shared_across_subjects'
])
const INTEGER_COLUMNS = new Set([
  'id',
  'parent_id',
  'relation_id',
  'item_id',
  'focus_id',
  'thread_id',
  'commitment_id',
  'scope_id',
  'subject_id',
  'base_scope_id',
  'context_subject_id',
  'from_scope_id',
  'to_scope_id',
  'from_focus_id',
  'from_thread_id',
  'to_focus_id',
  'to_thread_id',
  'todo_id',
  'list_id',
  'review_frequency_days',
  'cadence_days',
  'sort_key',
  'goal_revision',
  'description_revision',
  'observation_revision',
  'content_revision',
  'revision'
])
const TIMESTAMP_COLUMNS = new Set(['created_at', 'updated_at', 'changed_at'])
const OPTIONAL_TIMESTAMP_COLUMNS = new Set(['completed_at'])
const DATE_COLUMNS = new Set(['recorded_on', 'effective_from'])
const OPTIONAL_DATE_COLUMNS = new Set(['due_on', 'effective_until', 'review_poked_on'])

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function isRecord(value: unknown): value is ArchiveRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteInteger(value: unknown): number | null {
  const candidate = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof candidate === 'number' && Number.isSafeInteger(candidate) ? candidate : null
}

function booleanInteger(value: unknown): number | null {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1
  if (value === false || value === 0 || value === '0' || value === 'false') return 0
  return null
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function camelCase(column: string): string {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function sourceValue(source: ArchiveRow, column: string): unknown {
  if (Object.hasOwn(source, column)) return source[column]
  const alias = camelCase(column)
  return Object.hasOwn(source, alias) ? source[alias] : undefined
}

function sqliteValue(column: string, type: string, value: unknown): SqlValue | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (BOOLEAN_COLUMNS.has(column)) return booleanInteger(value) ?? undefined
  if (INTEGER_COLUMNS.has(column)) {
    const integer = finiteInteger(value)
    if (integer === null) return undefined
    if (column === 'sort_key') return Math.max(0, integer)
    if (column.endsWith('revision')) return Math.max(0, integer)
    if (column.endsWith('_days')) return integer > 0 ? integer : undefined
    if (column === 'id' || column.endsWith('_id')) return integer > 0 ? integer : undefined
    return integer
  }
  if (column.endsWith('_json')) {
    if (isRecord(value)) return JSON.stringify(value)
    if (typeof value !== 'string') return '{}'
    try {
      const parsed = JSON.parse(value) as unknown
      return isRecord(parsed) ? value : '{}'
    } catch {
      return '{}'
    }
  }
  if (DATE_COLUMNS.has(column)) return validDate(value) ? value : undefined
  if (OPTIONAL_DATE_COLUMNS.has(column)) return validDate(value) ? value : null
  if (OPTIONAL_TIMESTAMP_COLUMNS.has(column)) return validTimestamp(value) ? value : null
  if (type.toUpperCase().includes('TEXT')) {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return undefined
  }
  if (typeof value === 'string' || typeof value === 'number') return value
  return undefined
}

function setFallback(row: Record<string, SqlValue>, column: string, value: SqlValue): void {
  const current = row[column]
  if (current === undefined || current === null || (typeof current === 'string' && !current.trim())) {
    row[column] = value
  }
}

function keepOneParent(row: Record<string, SqlValue>, columns: readonly string[]): void {
  const selected = columns.find((column) => typeof row[column] === 'number')
  if (!selected) return
  for (const column of columns) {
    if (column !== selected) row[column] = null
  }
}

function normalizeRow(
  table: ArchiveTable,
  source: ArchiveRow,
  columns: readonly TableColumn[],
  rowNumber: number,
  now: Date,
  ignoredFields: Set<string>
): Record<string, SqlValue> {
  const row: Record<string, SqlValue> = {}
  const columnSet = new Set(columns.map(({ name }) => name))
  for (const key of Object.keys(source)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    if (!columnSet.has(key) && !columnSet.has(snakeKey)) ignoredFields.add(`${table}.${key}`)
  }
  for (const column of columns) {
    const value = sqliteValue(column.name, column.type, sourceValue(source, column.name))
    if (value !== undefined) row[column.name] = value
  }

  const timestamp = now.toISOString()
  const date = timestamp.slice(0, 10)
  for (const column of TIMESTAMP_COLUMNS) {
    if (columnSet.has(column)) setFallback(row, column, timestamp)
  }
  for (const column of DATE_COLUMNS) {
    if (columnSet.has(column)) setFallback(row, column, date)
  }

  const fallbackLabel = `Imported ${table.replaceAll('_', ' ')} ${String(row.id ?? rowNumber)}`
  if (columnSet.has('title')) setFallback(row, 'title', table === 'notes' ? 'Default' : fallbackLabel)
  if (columnSet.has('name')) setFallback(row, 'name', fallbackLabel)
  if (table === 'scopes') setFallback(row, 'dimension', 'default')
  if (table === 'threads') setFallback(row, 'review_frequency_days', 7)
  if (table === 'commitments') setFallback(row, 'commitment_type', 'ongoing')
  if (table === 'todo_sort_placements') setFallback(row, 'sort_key', 0)

  if (table === 'focuses' && row.kind !== 'generic') row.kind = 'generic'
  if (['focuses', 'threads', 'commitments'].includes(table)) {
    if (!['active', 'paused', 'done', 'cancelled'].includes(String(row.status))) {
      row.status = 'active'
    }
  }
  if (table === 'commitments' && !['action', 'ongoing'].includes(String(row.commitment_type))) {
    row.commitment_type = 'ongoing'
  }
  if (table === 'updates' && !['red', 'yellow', 'green', 'none'].includes(String(row.state))) {
    row.state = 'none'
  }
  if (table === 'scopes' && !['explicit', 'derived'].includes(String(row.source_type))) {
    row.source_type = 'explicit'
    row.derived_relationship = null
    row.context_subject_id = null
  }
  if (table === 'scopes') {
    if (
      row.source_type === 'derived' &&
      (typeof row.derived_relationship !== 'string' || !row.derived_relationship.trim() ||
        typeof row.context_subject_id !== 'number')
    ) {
      row.source_type = 'explicit'
    }
    if (row.source_type === 'explicit') {
      row.derived_relationship = null
      row.context_subject_id = null
    }
    if (row.base_scope_id === row.id) row.base_scope_id = null
  }
  if (table === 'scope_memberships' && !['include', 'exclude'].includes(String(row.effect))) {
    row.effect = 'include'
  }
  if (
    table === 'scope_memberships' &&
    typeof row.effective_from === 'string' &&
    typeof row.effective_until === 'string' &&
    row.effective_until <= row.effective_from
  ) {
    row.effective_until = null
  }
  if (table === 'subjects' && row.external_key === '') row.external_key = null
  if (table === 'items' && typeof row.current_status === 'string' && !row.current_status.trim()) {
    row.current_status = null
  }

  if (table === 'commitments') {
    keepOneParent(row, ['thread_id', 'focus_id'])
  }
  if (['updates', 'todos', 'todo_lists', 'notes'].includes(table)) {
    keepOneParent(row, ['commitment_id', 'thread_id', 'focus_id'])
  }
  if (table === 'scope_application_transitions') {
    keepOneParent(row, ['commitment_id', 'thread_id', 'focus_id'])
  }
  if (table === 'commitment_parent_transitions') {
    keepOneParent(row, ['from_thread_id', 'from_focus_id'])
    keepOneParent(row, ['to_thread_id', 'to_focus_id'])
  }
  return row
}

function archiveContainers(value: ArchiveRow): ArchiveRow[] {
  const containers = [value.tables, value.data, value]
  return containers.filter(isRecord)
}

function archiveRows(value: ArchiveRow, table: ArchiveTable): unknown[] | null {
  for (const container of archiveContainers(value)) {
    const rows = container[table]
    if (Array.isArray(rows)) return rows
  }
  return null
}

function tableNames(value: ArchiveRow): string[] {
  const names = new Set<string>()
  for (const container of archiveContainers(value)) {
    for (const [name, rows] of Object.entries(container)) {
      if (Array.isArray(rows)) names.add(name)
    }
  }
  return [...names]
}

function dropAndRememberTriggers(database: SqliteAdapter): TriggerRow[] {
  const triggers = database.all<TriggerRow>(
    "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL ORDER BY name"
  )
  for (const trigger of triggers) database.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)}`)
  return triggers
}

function restoreTriggers(database: SqliteAdapter, triggers: readonly TriggerRow[]): void {
  for (const trigger of triggers) database.exec(trigger.sql)
}

function removeForeignKeyViolations(database: SqliteAdapter): number {
  let removed = 0
  for (let pass = 0; pass < 100; pass += 1) {
    const violations = database.all<ForeignKeyViolation>('PRAGMA foreign_key_check')
    if (violations.length === 0) return removed
    let removedThisPass = 0
    for (const violation of violations) {
      if (!TABLE_SET.has(violation.table) || violation.rowid === null) {
        throw new Error(`Imported data violates an unsupported relation in ${violation.table}.`)
      }
      removedThisPass += database.run(
        `DELETE FROM ${quoteIdentifier(violation.table)} WHERE rowid = ?`,
        [violation.rowid]
      ).changes
    }
    removed += removedThisPass
    if (removedThisPass === 0) throw new Error('Imported relationships could not be repaired.')
  }
  throw new Error('Imported relationships contain too many invalid dependency layers.')
}

function cleanSemanticViolations(database: SqliteAdapter): number {
  const statements = [
    `DELETE FROM focus_scope_applications
     WHERE NOT (
       (mode = 'open' AND scope_id IS NULL) OR
       (mode IN ('explicit', 'derived') AND EXISTS (
         SELECT 1 FROM scopes scope
         WHERE scope.id = focus_scope_applications.scope_id
           AND scope.focus_id = focus_scope_applications.focus_id
           AND scope.source_type = focus_scope_applications.mode
       ))
     )`,
    `DELETE FROM thread_scope_applications
     WHERE NOT (
       (mode IN ('open', 'inherited') AND scope_id IS NULL) OR
       (mode IN ('explicit', 'derived') AND EXISTS (
         SELECT 1 FROM scopes scope
         JOIN threads thread ON thread.id = thread_scope_applications.thread_id
         WHERE scope.id = thread_scope_applications.scope_id
           AND scope.focus_id = thread.focus_id
           AND scope.source_type = thread_scope_applications.mode
       ))
     )`,
    `DELETE FROM commitment_scope_applications
     WHERE NOT EXISTS (
       SELECT 1 FROM commitments commitment
       WHERE commitment.id = commitment_scope_applications.commitment_id
         AND commitment_scope_applications.scope_id IS NULL
         AND commitment_scope_applications.mode = CASE
           WHEN commitment.thread_id IS NOT NULL THEN 'inherited' ELSE 'open'
         END
     )`,
    `DELETE FROM updates
     WHERE scope_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM scopes scope
       LEFT JOIN threads thread ON thread.id = updates.thread_id
       LEFT JOIN commitments commitment ON commitment.id = updates.commitment_id
       LEFT JOIN threads commitment_thread ON commitment_thread.id = commitment.thread_id
       WHERE scope.id = updates.scope_id
         AND scope.focus_id = COALESCE(
           thread.focus_id, commitment.focus_id, commitment_thread.focus_id
         )
     )`,
    `DELETE FROM todos
     WHERE scope_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM scopes scope
       LEFT JOIN threads thread ON thread.id = todos.thread_id
       LEFT JOIN commitments commitment ON commitment.id = todos.commitment_id
       LEFT JOIN threads commitment_thread ON commitment_thread.id = commitment.thread_id
       WHERE scope.id = todos.scope_id
         AND scope.focus_id = COALESCE(
           thread.focus_id, commitment.focus_id, commitment_thread.focus_id
         )
     )`,
    `DELETE FROM todo_lists
     WHERE scope_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM scopes scope
       LEFT JOIN threads thread ON thread.id = todo_lists.thread_id
       LEFT JOIN commitments commitment ON commitment.id = todo_lists.commitment_id
       LEFT JOIN threads commitment_thread ON commitment_thread.id = commitment.thread_id
       WHERE scope.id = todo_lists.scope_id
         AND scope.focus_id = COALESCE(
           thread.focus_id, commitment.focus_id, commitment_thread.focus_id
         )
     )`,
    `DELETE FROM todo_subject_completions
     WHERE NOT EXISTS (
       SELECT 1 FROM todos todo
       WHERE todo.id = todo_subject_completions.todo_id
         AND todo.shared_across_subjects = 1
     )`,
    `DELETE FROM todo_sort_placements
     WHERE NOT EXISTS (
       SELECT 1 FROM todos todo JOIN todo_lists list ON list.id = todo_sort_placements.list_id
       WHERE todo.id = todo_sort_placements.todo_id
         AND todo.focus_id IS list.focus_id
         AND todo.thread_id IS list.thread_id
         AND todo.commitment_id IS list.commitment_id
         AND (list.scope_id IS NULL OR (
           todo.shared_across_subjects = 0 AND
           todo.scope_id IS list.scope_id AND todo.subject_id IS list.subject_id
         ) OR (
           todo.shared_across_subjects = 1 AND todo.scope_id IS NULL AND EXISTS (
             SELECT 1 FROM todo_subject_completions completion
             WHERE completion.todo_id = todo.id
               AND completion.subject_id = list.subject_id
           )
         ))
     )`,
    `DELETE FROM rich_text_history
     WHERE (document_type = 'focus-goal' AND NOT EXISTS (
       SELECT 1 FROM focuses WHERE id = rich_text_history.entity_id
     )) OR (document_type = 'focus-description' AND NOT EXISTS (
       SELECT 1 FROM focuses WHERE id = rich_text_history.entity_id
     )) OR (document_type = 'update-observation' AND NOT EXISTS (
       SELECT 1 FROM updates WHERE id = rich_text_history.entity_id
     )) OR (document_type = 'note-content' AND NOT EXISTS (
       SELECT 1 FROM notes WHERE id = rich_text_history.entity_id
     ))`
  ]
  return statements.reduce((count, sql) => count + database.run(sql).changes, 0)
}

function repairRequiredRecords(database: SqliteAdapter, now: Date): number {
  const timestamp = now.toISOString()
  let repaired = 0
  repaired += database.run(
    `UPDATE todos
     SET completed_at = COALESCE(completed_at, updated_at, created_at, ?)
     WHERE done = 1 AND completed_at IS NULL`,
    [timestamp]
  ).changes
  repaired += database.run(
    `UPDATE todos
     SET done = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM todo_subject_completions completion
             WHERE completion.todo_id = todos.id AND completion.done = 0
           ) THEN 1 ELSE 0
         END,
         completed_at = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM todo_subject_completions completion
             WHERE completion.todo_id = todos.id AND completion.done = 0
           ) THEN COALESCE(completed_at, updated_at, created_at, ?)
           ELSE NULL
         END
     WHERE shared_across_subjects = 1`,
    [timestamp]
  ).changes
  repaired += database.run(
    `UPDATE todos SET completed_at = NULL
     WHERE done = 0 AND completed_at IS NOT NULL`
  ).changes
  repaired += database.run(
    `INSERT INTO focus_scope_applications (focus_id, mode, scope_id, updated_at)
     SELECT id, 'open', NULL, ? FROM focuses focus
     WHERE NOT EXISTS (
       SELECT 1 FROM focus_scope_applications application WHERE application.focus_id = focus.id
     )`,
    [timestamp]
  ).changes
  repaired += database.run(
    `INSERT INTO thread_scope_applications (thread_id, mode, scope_id, updated_at)
     SELECT thread.id,
            CASE WHEN parent.mode = 'open' THEN 'open' ELSE 'inherited' END,
            NULL, ?
     FROM threads thread
     JOIN focus_scope_applications parent ON parent.focus_id = thread.focus_id
     WHERE NOT EXISTS (
       SELECT 1 FROM thread_scope_applications application
       WHERE application.thread_id = thread.id
     )`,
    [timestamp]
  ).changes
  repaired += database.run(
    `INSERT INTO commitment_scope_applications (commitment_id, mode, scope_id, updated_at)
     SELECT id, CASE WHEN thread_id IS NOT NULL THEN 'inherited' ELSE 'open' END, NULL, ?
     FROM commitments commitment
     WHERE NOT EXISTS (
       SELECT 1 FROM commitment_scope_applications application
       WHERE application.commitment_id = commitment.id
     )`,
    [timestamp]
  ).changes

  for (const [table, parentColumn, parentTable] of [
    ['notes', 'focus_id', 'focuses'],
    ['notes', 'thread_id', 'threads'],
    ['notes', 'commitment_id', 'commitments']
  ] as const) {
    repaired += database.run(
      `INSERT INTO ${table} (${parentColumn}, title, created_at, updated_at)
       SELECT parent.id, 'Default', ?, ? FROM ${parentTable} parent
       WHERE NOT EXISTS (
         SELECT 1 FROM notes note WHERE note.${parentColumn} = parent.id
       )`,
      [timestamp, timestamp]
    ).changes
  }

  const transitionRepairs = [
    ['focus_status_transitions', 'focus_id', 'focuses'],
    ['thread_status_transitions', 'thread_id', 'threads'],
    ['commitment_status_transitions', 'commitment_id', 'commitments']
  ] as const
  for (const [transitionTable, foreignKey, parentTable] of transitionRepairs) {
    repaired += database.run(
      `INSERT INTO ${transitionTable} (${foreignKey}, from_status, to_status, changed_at)
       SELECT parent.id,
              (SELECT transition.to_status FROM ${transitionTable} transition
               WHERE transition.${foreignKey} = parent.id ORDER BY transition.id DESC LIMIT 1),
              parent.status, COALESCE(parent.status_changed_at, parent.updated_at, parent.created_at, ?)
       FROM ${parentTable} parent
       WHERE (SELECT transition.to_status FROM ${transitionTable} transition
              WHERE transition.${foreignKey} = parent.id
              ORDER BY transition.id DESC LIMIT 1) IS NOT parent.status`,
      [timestamp]
    ).changes
    repaired += database.run(
      `UPDATE ${parentTable}
       SET status_changed_at = (
         SELECT transition.changed_at FROM ${transitionTable} transition
         WHERE transition.${foreignKey} = ${parentTable}.id
         ORDER BY transition.id DESC LIMIT 1
       )
       WHERE status_changed_at IS NULL`
    ).changes
  }
  repaired += database.run(
    `INSERT INTO status_transitions (item_id, from_status, to_status, changed_at, meta_json)
     SELECT item.id,
            (SELECT transition.to_status FROM status_transitions transition
             WHERE transition.item_id = item.id ORDER BY transition.id DESC LIMIT 1),
            item.current_status, COALESCE(item.status_changed_at, item.updated_at, item.created_at, ?),
            item.status_meta_json
     FROM items item
     WHERE item.current_status IS NOT NULL AND (
       SELECT transition.to_status FROM status_transitions transition
       WHERE transition.item_id = item.id ORDER BY transition.id DESC LIMIT 1
     ) IS NOT item.current_status`,
    [timestamp]
  ).changes
  repaired += database.run(
    `UPDATE items
     SET status_changed_at = (
       SELECT transition.changed_at FROM status_transitions transition
       WHERE transition.item_id = items.id ORDER BY transition.id DESC LIMIT 1
     )
     WHERE status_changed_at IS NULL AND current_status IS NOT NULL`
  ).changes

  const scopeTransitionRepairs = [
    ['focus_scope_applications', 'focus_id'],
    ['thread_scope_applications', 'thread_id'],
    ['commitment_scope_applications', 'commitment_id']
  ] as const
  for (const [applicationTable, foreignKey] of scopeTransitionRepairs) {
    repaired += database.run(
      `INSERT INTO scope_application_transitions (
         ${foreignKey}, from_mode, from_scope_id, to_mode, to_scope_id, changed_at
       )
       SELECT application.${foreignKey}, NULL, NULL, application.mode,
              application.scope_id, application.updated_at
       FROM ${applicationTable} application
       WHERE NOT EXISTS (
         SELECT 1 FROM scope_application_transitions transition
         WHERE transition.${foreignKey} = application.${foreignKey}
       )`
    ).changes
  }
  repaired += database.run(
    `INSERT INTO commitment_parent_transitions (
       commitment_id, from_focus_id, from_thread_id,
       to_focus_id, to_thread_id, changed_at
     )
     SELECT commitment.id, NULL, NULL,
            commitment.focus_id, commitment.thread_id,
            COALESCE(commitment.created_at, ?)
     FROM commitments commitment
     WHERE NOT EXISTS (
       SELECT 1 FROM commitment_parent_transitions transition
       WHERE transition.commitment_id = commitment.id
     )`,
    [timestamp]
  ).changes
  return repaired
}

export class DataArchiveRepository {
  constructor(private readonly database: SqliteAdapter) {}

  export(appVersion: string, now = new Date()): DataArchive {
    const tables = {} as DataArchive['tables']
    for (const table of DATA_ARCHIVE_TABLES) {
      tables[table] = this.database.all<ArchiveRow>(
        `SELECT * FROM ${quoteIdentifier(table)}`
      )
    }
    return {
      format: DATA_ARCHIVE_FORMAT,
      archiveVersion: DATA_ARCHIVE_VERSION,
      schemaVersion: LATEST_SCHEMA_VERSION,
      appVersion,
      exportedAt: now.toISOString(),
      tables
    }
  }

  import(value: unknown, now = new Date()): DataImportSummary {
    if (!isRecord(value)) throw new Error('The selected file does not contain an object archive.')

    const knownRows = new Map<ArchiveTable, unknown[]>()
    for (const table of DATA_ARCHIVE_TABLES) {
      const rows = archiveRows(value, table)
      if (rows) knownRows.set(table, rows)
    }
    if (knownRows.size === 0) {
      throw new Error('The selected file does not contain any recognized OnMove tables.')
    }

    const ignoredTables = tableNames(value).filter((table) => !TABLE_SET.has(table)).sort()
    const ignoredFields = new Set<string>()
    const candidateRows = [...knownRows.values()].reduce((count, rows) => count + rows.length, 0)
    let successfulRows = 0
    let skippedRows = 0
    let repairedRows = 0
    let importedRows = 0
    const issues: DataImportSummary['issues'] = []

    this.database.transaction(() => {
      this.database.exec('PRAGMA defer_foreign_keys = ON')
      const triggers = dropAndRememberTriggers(this.database)
      for (const table of [...DATA_ARCHIVE_TABLES].reverse()) {
        this.database.run(`DELETE FROM ${quoteIdentifier(table)}`)
      }

      for (const table of DATA_ARCHIVE_TABLES) {
        const rows = knownRows.get(table) ?? []
        const columns = this.database.all<TableColumn>(
          `PRAGMA table_info(${quoteIdentifier(table)})`
        )
        for (const [index, source] of rows.entries()) {
          if (!isRecord(source)) {
            skippedRows += 1
            continue
          }
          const row = normalizeRow(table, source, columns, index + 1, now, ignoredFields)
          const names = Object.keys(row)
          if (names.length === 0) {
            skippedRows += 1
            continue
          }
          try {
            this.database.transaction(() => {
              this.database.run(
                `INSERT INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(', ')})
                 VALUES (${names.map(() => '?').join(', ')})`,
                names.map((name) => row[name])
              )
            })
            successfulRows += 1
          } catch (error) {
            skippedRows += 1
            if (issues.length < 50) {
              issues.push({
                table,
                row: index + 1,
                message: error instanceof Error ? error.message : 'Record rejected by SQLite.'
              })
            }
          }
        }
      }

      skippedRows += removeForeignKeyViolations(this.database)
      skippedRows += cleanSemanticViolations(this.database)
      importedRows = DATA_ARCHIVE_TABLES.reduce((count, table) => {
        const row = this.database.get<{ count: number }>(
          `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`
        )
        return count + Number(row?.count ?? 0)
      }, 0)
      skippedRows = Math.max(skippedRows, candidateRows - importedRows)
      if (candidateRows > 0 && (successfulRows === 0 || importedRows === 0)) {
        throw new Error('None of the records in this archive could be imported safely.')
      }

      restoreTriggers(this.database, triggers)
      repairedRows += repairRequiredRecords(this.database, now)
      const remainingViolations = this.database.all<ForeignKeyViolation>('PRAGMA foreign_key_check')
      if (remainingViolations.length > 0) {
        throw new Error('The imported data still contains invalid relationships.')
      }
      const integrity = this.database.get<{ integrity_check: string }>('PRAGMA integrity_check')
      if (integrity?.integrity_check !== 'ok') {
        throw new Error('SQLite rejected the imported data during its integrity check.')
      }
    })

    return {
      sourceArchiveVersion: finiteInteger(value.archiveVersion),
      sourceSchemaVersion: finiteInteger(value.schemaVersion),
      candidateRows,
      importedRows,
      skippedRows,
      repairedRows,
      ignoredTables,
      ignoredFields: [...ignoredFields].sort(),
      issues
    }
  }
}
