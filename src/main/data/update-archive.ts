import type { HealthState, UpdateParent, UpdateScopeCell } from '../../shared/contracts'
import type { SqliteAdapter } from './sqlite-adapter'

export const UPDATE_ARCHIVE_DELETE_TRIGGER = 'updates_archive_before_delete'

const LIVE_COLUMNS = [
  'id',
  'focus_id',
  'thread_id',
  'commitment_id',
  'scope_id',
  'subject_id',
  'recorded_on',
  'observation',
  'state',
  'sensitive',
  'observation_revision',
  'created_at',
  'updated_at'
] as const

const ARCHIVE_MIRROR_COLUMNS = ['update_id', ...LIVE_COLUMNS.slice(1)] as const

interface ColumnRow { name: string }
interface TriggerRow { found: number }

interface ArchivedUpdateRow {
  archive_id: string
  update_id: number
  focus_id: number | null
  thread_id: number | null
  commitment_id: number | null
  scope_id: number | null
  subject_id: number | null
  recorded_on: string
  observation: string
  state: string
  sensitive: number
  observation_revision: number
  created_at: string
  updated_at: string
  deleted_at: string
}

export interface ArchivedUpdateSnapshot {
  archiveId: string
  originalUpdateId: number
  parent: UpdateParent
  scope: UpdateScopeCell | null
  date: string
  observation: string
  state: HealthState
  sensitive: boolean
  observationRevision: number
  createdAt: string
  updatedAt: string
  deletedAt: string
}

function sameColumns(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    [...actual].sort().every((column, index) => column === [...expected].sort()[index])
}

function parentFromRow(row: ArchivedUpdateRow): UpdateParent {
  if (row.focus_id !== null) return { type: 'focus', id: Number(row.focus_id) }
  if (row.thread_id !== null) return { type: 'thread', id: Number(row.thread_id) }
  return { type: 'commitment', id: Number(row.commitment_id) }
}

/**
 * Read-only access to rescued Updates. SQLite owns the write path: one BEFORE
 * DELETE trigger covers explicit deletes and every foreign-key cascade.
 */
export class UpdateArchiveRepository {
  constructor(private readonly database: SqliteAdapter) {
    this.assertProtectionInstalled()
  }

  list(): ArchivedUpdateSnapshot[] {
    return this.rows().map((row) => this.fromRow(row))
  }

  listForOriginalUpdate(updateId: number): ArchivedUpdateSnapshot[] {
    if (!Number.isInteger(updateId) || updateId <= 0) return []
    return this.rows('WHERE update_id = ?', [updateId]).map((row) => this.fromRow(row))
  }

  private rows(where = '', parameters: readonly number[] = []): ArchivedUpdateRow[] {
    return this.database.all<ArchivedUpdateRow>(`
      SELECT archive_id, update_id, focus_id, thread_id, commitment_id,
             scope_id, subject_id, recorded_on, observation, state, sensitive,
             observation_revision, created_at, updated_at, deleted_at
      FROM archived_updates
      ${where}
      ORDER BY deleted_at DESC, archive_id
    `, parameters)
  }

  private assertProtectionInstalled(): void {
    const liveColumns = this.database.all<ColumnRow>('PRAGMA table_info(updates)')
      .map(({ name }) => name)
    // Some historical migration fixtures intentionally contain no work domain at all.
    // Repositories remain lazy in that unsupported partial-schema case, as the other
    // domain repositories do; a present Updates table must always be protected.
    if (liveColumns.length === 0) return
    const archiveColumns = this.database.all<ColumnRow>('PRAGMA table_info(archived_updates)')
      .map(({ name }) => name)
    const trigger = this.database.get<TriggerRow>(
      `SELECT 1 AS found FROM sqlite_master
       WHERE type = 'trigger' AND name = ? AND tbl_name = 'updates'`,
      [UPDATE_ARCHIVE_DELETE_TRIGGER]
    )

    if (
      !sameColumns(liveColumns, LIVE_COLUMNS) ||
      !sameColumns(archiveColumns.slice(1, -1), ARCHIVE_MIRROR_COLUMNS) ||
      !trigger
    ) {
      throw new Error(
        'Update archival protection is incomplete; every live Update column must be mirrored.'
      )
    }
  }

  private fromRow(row: ArchivedUpdateRow): ArchivedUpdateSnapshot {
    return {
      archiveId: row.archive_id,
      originalUpdateId: Number(row.update_id),
      parent: parentFromRow(row),
      scope: row.scope_id === null
        ? null
        : { scopeId: Number(row.scope_id), subjectId: Number(row.subject_id) },
      date: row.recorded_on,
      observation: row.observation,
      state: row.state as HealthState,
      sensitive: Boolean(row.sensitive),
      observationRevision: Number(row.observation_revision),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at
    }
  }
}
