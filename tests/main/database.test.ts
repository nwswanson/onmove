import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { LATEST_SCHEMA_VERSION } from '../../src/main/data/migrations'

describe('AppDatabase', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-database-test-'))
    databasePath = join(directory, 'nested', 'onmove.sqlite3')
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates the database and returns an empty initial state', () => {
    database = new AppDatabase(databasePath)

    expect(existsSync(databasePath)).toBe(true)
    expect(database.getState()).toEqual({
      greeting: 'Hello, world.',
      greetingCount: 0,
      launchCount: 0,
      lastGreetingAt: null,
      databasePath
    })
  })

  it('records launches and greetings with stable timestamps', () => {
    database = new AppDatabase(databasePath)
    database.recordLaunch(new Date('2026-01-02T03:04:05.000Z'))
    const state = database.recordGreeting(new Date('2026-02-03T04:05:06.000Z'))

    expect(state.launchCount).toBe(1)
    expect(state.greetingCount).toBe(1)
    expect(state.lastGreetingAt).toBe('2026-02-03T04:05:06.000Z')
  })

  it('retains data after the database is closed and reopened', () => {
    database = new AppDatabase(databasePath)
    database.recordLaunch()
    database.recordGreeting()
    database.close()

    database = new AppDatabase(databasePath)
    expect(database.getState()).toMatchObject({ launchCount: 1, greetingCount: 1 })
  })

  it('applies each schema migration exactly once', () => {
    database = new AppDatabase(databasePath)
    database.close()
    database = new AppDatabase(databasePath)
    database.close()
    database = undefined

    const rawDatabase = new DatabaseSync(databasePath)
    const row = rawDatabase.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number
    }
    rawDatabase.close()

    expect(Number(row.count)).toBe(LATEST_SCHEMA_VERSION)
  })
})
