import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('navigation pin preferences', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-navigation-pins-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('persists idempotent Focus and Thread references without changing their models', () => {
    const focus = database.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const pinnedAt = new Date('2026-08-21T12:00:00.000Z')

    database.navigationPins.set({ type: 'focus', id: focus.id }, true, pinnedAt)
    database.navigationPins.set({ type: 'thread', id: thread.id }, true, pinnedAt)
    database.navigationPins.set({ type: 'thread', id: thread.id }, true, pinnedAt)

    expect(database.navigationPins.list()).toEqual([
      expect.objectContaining({
        target: { type: 'focus', id: focus.id },
        title: 'Project Atlas',
        status: 'active'
      }),
      expect.objectContaining({
        target: { type: 'thread', id: thread.id, focusId: focus.id },
        title: 'Sprint execution',
        status: 'active',
        ancestorSensitive: false
      })
    ])
    expect(database.domain.focuses.requireModel(focus.id).toSnapshot()).not.toHaveProperty('pinned')
    expect(database.domain.threads.requireModel(thread.id).snapshot()).not.toHaveProperty('pinned')

    database.close()
    database = new AppDatabase(databasePath)
    expect(database.navigationPins.list()).toHaveLength(2)
  })

  it('resolves live metadata and lets foreign keys clean up deleted targets', () => {
    const focus = database.domain.focuses.create({ title: 'Original title' })
    const destination = database.domain.focuses.create({ title: 'Destination' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Original Thread',
      reviewFrequencyDays: 7
    })
    database.navigationPins.set({ type: 'focus', id: focus.id }, true)
    database.navigationPins.set({ type: 'thread', id: thread.id }, true)

    focus.update({ title: 'Renamed Focus', sensitive: true })
    thread.update({ title: 'Renamed Thread', needsReview: false })
    expect(database.navigationPins.list()).toEqual([
      expect.objectContaining({ title: 'Renamed Focus', sensitive: true }),
      expect.objectContaining({
        title: 'Renamed Thread',
        needsReview: false,
        ancestorSensitive: true
      })
    ])

    thread.moveTo({
      focusId: destination.id,
      plannedFromFocusId: focus.id,
      confirmedScopeSubjectIds: []
    })
    expect(database.navigationPins.list()[1]).toEqual(expect.objectContaining({
      target: { type: 'thread', id: thread.id, focusId: destination.id }
    }))

    expect(database.domain.threads.delete(thread.id)).toBe(true)
    expect(database.navigationPins.list()).toEqual([
      expect.objectContaining({ target: { type: 'focus', id: focus.id } })
    ])
    expect(database.domain.focuses.delete(focus.id)).toBe(true)
    expect(database.navigationPins.list()).toEqual([])
  })

  it('rejects nonexistent targets and unpinning an absent target is harmless', () => {
    expect(() => database.navigationPins.set({ type: 'thread', id: 999 }, true))
      .toThrow('Thread 999 does not exist')
    expect(database.navigationPins.set({ type: 'focus', id: 999 }, false)).toEqual([])
  })
})
