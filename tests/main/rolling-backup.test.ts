import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { RollingBackupRepository } from '../../src/main/data/rolling-backup'

describe('RollingBackupRepository', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-backup-test-'))
    databasePath = join(directory, 'OnMove', 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates a verified standalone SQLite snapshot with private permissions', () => {
    const focus = database!.domain.focuses.create({ title: 'Recoverable focus' })
    const state = database!.backups.create(new Date('2026-08-10T12:34:56.789Z'))

    expect(state).toMatchObject({
      automatic: true,
      intervalHours: 24,
      retentionLimit: 10,
      lastBackupAt: '2026-08-10T12:34:56.789Z',
      nextBackupAt: '2026-08-11T12:34:56.789Z'
    })
    expect(state.backups).toHaveLength(1)

    const backupPath = join(state.directoryPath, state.backups[0].fileName)
    expect(existsSync(backupPath)).toBe(true)
    expect(statSync(backupPath).mode & 0o777).toBe(0o600)
    expect(statSync(state.directoryPath).mode & 0o077).toBe(0)

    const backup = new DatabaseSync(backupPath, { readOnly: true })
    expect(backup.prepare('PRAGMA quick_check').get()).toMatchObject({ quick_check: 'ok' })
    expect(backup.prepare('SELECT title FROM focuses WHERE id = ?').get(focus.id))
      .toMatchObject({ title: 'Recoverable focus' })
    backup.close()
  })

  it('backs up at most once per 24-hour interval unless explicitly requested', () => {
    const first = database!.backups.createIfDue(new Date('2026-08-01T10:00:00.000Z'))
    const notDue = database!.backups.createIfDue(new Date('2026-08-02T09:59:59.999Z'))
    const due = database!.backups.createIfDue(new Date('2026-08-02T10:00:00.000Z'))
    const manual = database!.backups.create(new Date('2026-08-02T10:01:00.000Z'))

    expect(first.backups).toHaveLength(1)
    expect(notDue.backups).toHaveLength(1)
    expect(due.backups).toHaveLength(2)
    expect(manual.backups).toHaveLength(3)
    expect(manual.lastBackupAt).toBe('2026-08-02T10:01:00.000Z')
  })

  it('retains the newest ten snapshots without touching unknown files', () => {
    const backupDirectory = database!.backups.ensureDirectory()
    const unknownPath = join(backupDirectory, 'read-me.txt')
    writeFileSync(unknownPath, 'keep')

    for (let day = 1; day <= 12; day += 1) {
      database!.backups.create(new Date(`2026-08-${String(day).padStart(2, '0')}T12:00:00.000Z`))
    }

    const state = database!.backups.getState()
    expect(state.backups).toHaveLength(10)
    expect(state.backups[0].createdAt).toBe('2026-08-12T12:00:00.000Z')
    expect(state.backups.at(-1)?.createdAt).toBe('2026-08-03T12:00:00.000Z')
    expect(existsSync(unknownPath)).toBe(true)
  })

  it('removes interrupted temporary copies while preserving completed backups', () => {
    const backupDirectory = database!.backups.ensureDirectory()
    const interrupted = join(backupDirectory, '.onmove-backup-interrupted.pending')
    mkdirSync(backupDirectory, { recursive: true })
    writeFileSync(interrupted, 'partial')
    database!.backups.create(new Date('2026-08-10T12:00:00.000Z'))

    expect(existsSync(interrupted)).toBe(false)
    expect(readdirSync(backupDirectory).filter((name) => name.endsWith('.sqlite3'))).toHaveLength(1)
  })

  it('keeps completed recovery points when the source integrity check fails', () => {
    const completed = database!.backups.create(new Date('2026-08-10T12:00:00.000Z'))
    const failingRepository = new RollingBackupRepository({
      all: () => [{ quick_check: 'database disk image is malformed' }]
    } as never, databasePath)

    expect(() => failingRepository.create(new Date('2026-08-11T12:00:00.000Z')))
      .toThrow(/no backup was rotated/)
    expect(failingRepository.getState().backups.map(({ fileName }) => fileName))
      .toEqual([completed.backups[0].fileName])
  })

  it('keeps a snapshot unchanged when live records are later deleted', () => {
    const focus = database!.domain.focuses.create({ title: 'Before deletion' })
    const state = database!.backups.create(new Date('2026-08-10T12:00:00.000Z'))
    focus.delete()

    const backup = new DatabaseSync(
      join(state.directoryPath, state.backups[0].fileName),
      { readOnly: true }
    )
    expect(backup.prepare('SELECT title FROM focuses').get())
      .toMatchObject({ title: 'Before deletion' })
    backup.close()
    expect(database!.domain.focuses.list()).toEqual([])
  })
})
