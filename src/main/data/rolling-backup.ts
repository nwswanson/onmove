import {
  chmodSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { BackupSnapshot, BackupStateSnapshot } from '../../shared/contracts'
import type { SqliteAdapter } from './sqlite-adapter'

export const BACKUP_RETENTION_LIMIT = 10
export const BACKUP_INTERVAL_HOURS = 24
export const BACKUP_INTERVAL_MS = BACKUP_INTERVAL_HOURS * 60 * 60 * 1000

const BACKUP_DIRECTORY_NAME = 'Backups'
const BACKUP_NAME = /^onmove-backup-(\d{8}T\d{9}Z)-[0-9a-f-]+\.sqlite3$/
const PENDING_NAME = /^\.onmove-backup-.*\.pending$/

interface QuickCheckRow {
  quick_check: string
}

function timestampForFilename(now: Date): string {
  return now.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.', '')
}

function timestampFromFilename(fileName: string): string | null {
  const match = BACKUP_NAME.exec(fileName)
  if (!match) return null
  const compact = match[1]
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}.${compact.slice(15, 18)}Z`
}

function integrityIsValid(rows: readonly QuickCheckRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.quick_check === 'ok')
}

/**
 * Creates SQLite-owned, verified snapshots and rotates only after a new copy is durable.
 * Unknown files in the backup directory are deliberately ignored.
 */
export class RollingBackupRepository {
  readonly directoryPath: string

  constructor(
    private readonly database: SqliteAdapter,
    databasePath: string
  ) {
    this.directoryPath = join(dirname(databasePath), BACKUP_DIRECTORY_NAME)
  }

  ensureDirectory(): string {
    mkdirSync(this.directoryPath, { recursive: true, mode: 0o700 })
    return this.directoryPath
  }

  getState(): BackupStateSnapshot {
    const backups = this.list()
    const lastBackupAt = backups[0]?.createdAt ?? null
    return {
      automatic: true,
      intervalHours: BACKUP_INTERVAL_HOURS,
      retentionLimit: BACKUP_RETENTION_LIMIT,
      directoryPath: this.directoryPath,
      lastBackupAt,
      nextBackupAt: lastBackupAt === null
        ? null
        : new Date(new Date(lastBackupAt).getTime() + BACKUP_INTERVAL_MS).toISOString(),
      backups
    }
  }

  createIfDue(now = new Date()): BackupStateSnapshot {
    const state = this.getState()
    if (
      state.lastBackupAt !== null &&
      now.getTime() - new Date(state.lastBackupAt).getTime() < BACKUP_INTERVAL_MS
    ) {
      return state
    }
    return this.create(now)
  }

  create(now = new Date()): BackupStateSnapshot {
    this.ensureDirectory()
    this.removeInterruptedCopies()
    this.assertSourceIntegrity()

    const identifier = randomUUID()
    const stem = `onmove-backup-${timestampForFilename(now)}-${identifier}`
    const pendingPath = join(this.directoryPath, `.${stem}.pending`)
    const finalPath = join(this.directoryPath, `${stem}.sqlite3`)

    try {
      this.database.run('VACUUM INTO ?', [pendingPath])
      this.assertBackupIntegrity(pendingPath)
      chmodSync(pendingPath, 0o600)
      renameSync(pendingPath, finalPath)
      this.prune()
      return this.getState()
    } catch (error) {
      rmSync(pendingPath, { force: true })
      throw error
    }
  }

  private list(): BackupSnapshot[] {
    this.ensureDirectory()
    this.removeInterruptedCopies()
    return readdirSync(this.directoryPath, { withFileTypes: true })
      .flatMap((entry) => {
        if (!entry.isFile()) return []
        const createdAt = timestampFromFilename(entry.name)
        if (createdAt === null) return []
        const details = statSync(join(this.directoryPath, entry.name))
        return [{ fileName: entry.name, createdAt, sizeBytes: details.size }]
      })
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.fileName.localeCompare(left.fileName)
      )
  }

  private removeInterruptedCopies(): void {
    for (const entry of readdirSync(this.directoryPath, { withFileTypes: true })) {
      if (entry.isFile() && PENDING_NAME.test(entry.name)) {
        rmSync(join(this.directoryPath, entry.name), { force: true })
      }
    }
  }

  private assertSourceIntegrity(): void {
    const rows = this.database.all<QuickCheckRow>('PRAGMA quick_check')
    if (!integrityIsValid(rows)) {
      throw new Error('The current database did not pass SQLite integrity checks; no backup was rotated.')
    }
  }

  private assertBackupIntegrity(path: string): void {
    const backup = new DatabaseSync(path, { readOnly: true })
    try {
      const rows = backup.prepare('PRAGMA quick_check').all() as unknown as QuickCheckRow[]
      if (!integrityIsValid(rows)) {
        throw new Error('The new backup did not pass SQLite integrity checks.')
      }
    } finally {
      backup.close()
    }
  }

  private prune(): void {
    for (const backup of this.list().slice(BACKUP_RETENTION_LIMIT)) {
      rmSync(join(this.directoryPath, backup.fileName), { force: true })
    }
  }
}
