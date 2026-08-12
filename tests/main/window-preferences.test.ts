import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('WindowPreferenceRepository', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-window-preferences-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('stores one last-write-wins main window size', () => {
    expect(database?.windowPreferences.getSize()).toBeNull()

    expect(database?.windowPreferences.setSize(
      { width: 1180, height: 720 },
      new Date('2026-08-11T10:00:00.000Z')
    )).toEqual({
      width: 1180,
      height: 720,
      updatedAt: '2026-08-11T10:00:00.000Z'
    })
    database?.windowPreferences.setSize(
      { width: 1100, height: 680 },
      new Date('2026-08-11T10:00:01.000Z')
    )

    expect(database?.windowPreferences.getSize()).toEqual({
      width: 1100,
      height: 680,
      updatedAt: '2026-08-11T10:00:01.000Z'
    })
  })

  it('retains the latest size after reopening the database', () => {
    database?.windowPreferences.setSize({ width: 1240, height: 740 })
    database?.close()

    database = new AppDatabase(databasePath)
    expect(database.windowPreferences.getSize()).toMatchObject({
      width: 1240,
      height: 740
    })
  })

  it('rejects dimensions that cannot be valid Electron window sizes', () => {
    expect(() => database?.windowPreferences.setSize({ width: 0, height: 700 }))
      .toThrow(/positive, safe integer/)
    expect(() => database?.windowPreferences.setSize({ width: 1100.5, height: 700 }))
      .toThrow(/positive, safe integer/)
    expect(() => database?.windowPreferences.setSize({ width: 1100, height: 32768 }))
      .toThrow(/positive, safe integer/)
    expect(database?.windowPreferences.getSize()).toBeNull()
  })
})
