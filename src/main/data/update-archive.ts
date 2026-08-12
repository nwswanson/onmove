import type {
  ArchivedUpdateOverviewSnapshot,
  ArchivedUpdateSnapshot,
  HealthState,
  UpdateParent
} from '../../shared/contracts'
import type { SqliteAdapter } from './sqlite-adapter'

export const UPDATE_ARCHIVE_DELETE_TRIGGER = 'updates_archive_before_delete'
export const UPDATE_ARCHIVE_RETENTION_TRIGGER = 'archived_updates_enforce_retention'
export const UPDATE_ARCHIVE_RETENTION_DAYS = 30
const ARCHIVE_CONTEXT_TRIGGER_NAMES = [
  'focuses_prepare_update_archive_context',
  'threads_prepare_update_archive_context',
  'commitments_prepare_update_archive_context',
  'scopes_prepare_update_archive_context',
  'subjects_prepare_update_archive_context'
] as const

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
const ARCHIVE_CONTEXT_COLUMNS = [
  'focus_title',
  'thread_title',
  'commitment_title',
  'subject_name',
  'effective_sensitive'
] as const

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
  focus_title: string | null
  thread_title: string | null
  commitment_title: string | null
  subject_name: string | null
  effective_sensitive: number
  deleted_at: string
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

function archiveCutoff(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new TypeError('Archive retention requires a valid date.')
  return new Date(
    now.getTime() - UPDATE_ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1_000
  ).toISOString()
}

export function purgeExpiredArchivedUpdates(
  database: SqliteAdapter,
  now = new Date()
): number {
  const archiveExists = database.get<TriggerRow>(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'archived_updates'"
  )
  if (!archiveExists) return 0
  const cutoff = archiveCutoff(now)
  return database.run(
    'DELETE FROM archived_updates WHERE julianday(deleted_at) < julianday(?)',
    [cutoff]
  ).changes
}

/**
 * Lifecycle access to rescued Updates. SQLite owns archival writes through one
 * BEFORE DELETE trigger; this repository owns the only supported destructive
 * operations and the bounded retention policy. Archived content cannot be edited.
 */
export class UpdateArchiveRepository {
  constructor(private readonly database: SqliteAdapter) {
    if (this.assertProtectionInstalled()) this.purgeExpired()
  }

  overview(now = new Date()): ArchivedUpdateOverviewSnapshot {
    const retainedSince = archiveCutoff(now)
    this.purgeExpired(now)
    return {
      generatedAt: now.toISOString(),
      retainedSince,
      retentionDays: UPDATE_ARCHIVE_RETENTION_DAYS,
      items: this.rows(
        'WHERE julianday(deleted_at) >= julianday(?)',
        [retainedSince]
      ).map((row) => this.fromRow(row))
    }
  }

  list(now = new Date()): ArchivedUpdateSnapshot[] {
    return this.overview(now).items
  }

  listForOriginalUpdate(updateId: number, now = new Date()): ArchivedUpdateSnapshot[] {
    if (!Number.isInteger(updateId) || updateId <= 0) return []
    const retainedSince = archiveCutoff(now)
    this.purgeExpired(now)
    return this.rows(
      'WHERE update_id = ? AND julianday(deleted_at) >= julianday(?)',
      [updateId, retainedSince]
    ).map((row) => this.fromRow(row))
  }

  delete(archiveId: string): boolean {
    const normalized = archiveId.trim().toLowerCase()
    if (!/^[0-9a-f]{32}$/.test(normalized)) return false
    return this.database.run(
      'DELETE FROM archived_updates WHERE archive_id = ?',
      [normalized]
    ).changes > 0
  }

  clear(): number {
    return this.database.run('DELETE FROM archived_updates').changes
  }

  purgeExpired(now = new Date()): number {
    return purgeExpiredArchivedUpdates(this.database, now)
  }

  private rows(where = '', parameters: readonly (number | string)[] = []): ArchivedUpdateRow[] {
    return this.database.all<ArchivedUpdateRow>(`
      SELECT archive_id, update_id, focus_id, thread_id, commitment_id,
             scope_id, subject_id, recorded_on, observation, state, sensitive,
             observation_revision, created_at, updated_at,
             focus_title, thread_title, commitment_title, subject_name,
             effective_sensitive, deleted_at
      FROM archived_updates
      ${where}
      ORDER BY deleted_at DESC, archive_id
    `, parameters)
  }

  private assertProtectionInstalled(): boolean {
    const liveColumns = this.database.all<ColumnRow>('PRAGMA table_info(updates)')
      .map(({ name }) => name)
    // Some historical migration fixtures intentionally contain no work domain at all.
    // Repositories remain lazy in that unsupported partial-schema case, as the other
    // domain repositories do; a present Updates table must always be protected.
    if (liveColumns.length === 0) return false
    const archiveColumns = this.database.all<ColumnRow>('PRAGMA table_info(archived_updates)')
      .map(({ name }) => name)
    const trigger = this.database.get<TriggerRow>(
      `SELECT 1 AS found FROM sqlite_master
      WHERE type = 'trigger' AND name = ? AND tbl_name = 'updates'`,
      [UPDATE_ARCHIVE_DELETE_TRIGGER]
    )
    const retentionTrigger = this.database.get<TriggerRow>(
      `SELECT 1 AS found FROM sqlite_master
       WHERE type = 'trigger' AND name = ? AND tbl_name = 'archived_updates'`,
      [UPDATE_ARCHIVE_RETENTION_TRIGGER]
    )
    const mirroredColumns = archiveColumns.filter((column) =>
      ARCHIVE_MIRROR_COLUMNS.some((expected) => expected === column))
    const contextTriggers = ARCHIVE_CONTEXT_TRIGGER_NAMES.every((name) =>
      Boolean(this.database.get<TriggerRow>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'trigger' AND name = ?",
        [name]
      )))

    if (
      !sameColumns(liveColumns, LIVE_COLUMNS) ||
      !sameColumns(mirroredColumns, ARCHIVE_MIRROR_COLUMNS) ||
      !ARCHIVE_CONTEXT_COLUMNS.every((column) => archiveColumns.includes(column)) ||
      !trigger ||
      !retentionTrigger ||
      !contextTriggers
    ) {
      throw new Error(
        'Update archival protection is incomplete; every live Update column must be mirrored.'
      )
    }
    return true
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
      context: {
        focusTitle: row.focus_title,
        threadTitle: row.thread_title,
        commitmentTitle: row.commitment_title,
        subjectName: row.subject_name
      },
      effectiveSensitive: Boolean(row.effective_sensitive),
      deletedAt: row.deleted_at
    }
  }
}
