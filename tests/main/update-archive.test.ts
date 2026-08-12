import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('UpdateArchiveRepository', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-update-archive-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('archives an explicit Update delete exactly once with its complete durable state', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const update = database!.domain.updates.create({
      parent: { type: 'focus', id: focus.id },
      date: '2026-08-12',
      observation: 'Launch readiness is green.',
      state: 'green',
      sensitive: true
    }, new Date('2026-08-12T12:00:00.000Z'))

    expect(database!.domain.updates.delete(update.id)).toBe(true)
    expect(database!.domain.updates.delete(update.id)).toBe(false)
    expect(database!.domain.archivedUpdates.list()).toMatchObject([{
      archiveId: expect.stringMatching(/^[0-9a-f]{32}$/),
      originalUpdateId: update.id,
      parent: { type: 'focus', id: focus.id },
      scope: null,
      date: '2026-08-12',
      observation: 'Launch readiness is green.',
      state: 'green',
      sensitive: true,
      observationRevision: 0,
      createdAt: '2026-08-12T12:00:00.000Z',
      updatedAt: '2026-08-12T12:00:00.000Z',
      deletedAt: expect.any(String)
    }])
    expect(Number.isNaN(Date.parse(database!.domain.archivedUpdates.list()[0].deletedAt)))
      .toBe(false)
  })

  it('rescues every direct and descendant Update when a Focus cascade deletes its tree', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const scope = database!.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Customer Operations' },
      new Date('2026-08-12T09:00:00.000Z')
    )
    const cell = {
      scopeId: scope.scopeId as number,
      subjectId: scope.subjects[0].id
    }
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Improve ticket quality'
    })
    const updates = [
      database!.domain.updates.create({
        parent: { type: 'focus', id: focus.id },
        observation: 'Portfolio evidence'
      }),
      database!.domain.updates.create({
        parent: { type: 'thread', id: thread.id },
        scope: cell,
        observation: 'Thread evidence'
      }),
      database!.domain.updates.create({
        parent: { type: 'commitment', id: commitment.id },
        scope: cell,
        observation: 'Commitment evidence'
      })
    ]

    expect(database!.domain.focuses.delete(focus.id)).toBe(true)
    expect(database!.domain.archivedUpdates.list()).toHaveLength(3)
    expect(new Set(database!.domain.archivedUpdates.list().map(({ originalUpdateId }) =>
      originalUpdateId))).toEqual(new Set(updates.map(({ id }) => id)))
    expect(database!.domain.archivedUpdates.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parent: { type: 'thread', id: thread.id },
        scope: cell,
        observation: 'Thread evidence'
      }),
      expect.objectContaining({
        parent: { type: 'commitment', id: commitment.id },
        scope: cell,
        observation: 'Commitment evidence'
      })
    ]))
  })

  it('rescues scoped evidence from a Subject-oriented cleanup without retaining foreign keys', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Regional rollout',
      reviewFrequencyDays: 7
    })
    const scope = database!.domain.threadScopes.addSubject(thread.id, { name: 'North' })
    const cell = { scopeId: scope.scopeId as number, subjectId: scope.subjects[0].id }
    const update = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      scope: cell,
      observation: 'North is ready.'
    })

    database!.close()
    database = undefined
    const raw = new DatabaseSync(databasePath)
    raw.exec('PRAGMA foreign_keys = ON;')
    raw.prepare('DELETE FROM updates WHERE subject_id = ?').run(cell.subjectId)
    raw.close()

    database = new AppDatabase(databasePath)
    expect(database.domain.archivedUpdates.listForOriginalUpdate(update.id)).toMatchObject([{
      parent: { type: 'thread', id: thread.id },
      scope: cell,
      observation: 'North is ready.'
    }])
  })

  it('keeps archive rows immutable at the SQLite boundary', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const update = database!.domain.updates.create({
      parent: { type: 'focus', id: focus.id },
      observation: 'Retain this.'
    })
    database!.domain.updates.delete(update.id)
    const archived = database!.domain.archivedUpdates.list()[0]

    database!.close()
    database = undefined
    const raw = new DatabaseSync(databasePath)
    expect(() => raw.prepare(
      'UPDATE archived_updates SET observation = ? WHERE archive_id = ?'
    ).run('Changed', archived.archiveId)).toThrow(/immutable/)
    expect(() => raw.prepare(
      'DELETE FROM archived_updates WHERE archive_id = ?'
    ).run(archived.archiveId)).toThrow(/cannot be deleted/)
    raw.close()
  })

  it('rolls archive writes back atomically when the deleting transaction fails', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const update = database!.domain.updates.create({
      parent: { type: 'focus', id: focus.id },
      observation: 'Do not archive a rolled-back delete.'
    })
    database!.close()
    database = undefined

    const raw = new DatabaseSync(databasePath)
    raw.exec('BEGIN IMMEDIATE;')
    raw.prepare('DELETE FROM updates WHERE id = ?').run(update.id)
    expect(raw.prepare('SELECT count(*) AS count FROM archived_updates').get())
      .toMatchObject({ count: 1 })
    raw.exec('ROLLBACK;')
    expect(raw.prepare('SELECT count(*) AS count FROM updates WHERE id = ?').get(update.id))
      .toMatchObject({ count: 1 })
    expect(raw.prepare('SELECT count(*) AS count FROM archived_updates').get())
      .toMatchObject({ count: 0 })
    raw.close()
  })

  it('fails closed if a future live Update field is not added to the archive contract', () => {
    database!.close()
    database = undefined
    const raw = new DatabaseSync(databasePath)
    raw.exec("ALTER TABLE updates ADD COLUMN future_evidence TEXT NOT NULL DEFAULT '';")
    raw.close()

    expect(() => new AppDatabase(databasePath)).toThrow(/archival protection is incomplete/)
  })
})
