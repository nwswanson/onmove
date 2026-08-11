import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { DATA_ARCHIVE_FORMAT } from '../../src/main/data/data-archive'

describe('DataArchiveRepository', () => {
  const databases: AppDatabase[] = []
  const directories: string[] = []

  function createDatabase(name: string): AppDatabase {
    const directory = mkdtempSync(join(tmpdir(), `onmove-${name}-`))
    directories.push(directory)
    const database = new AppDatabase(join(directory, 'onmove.sqlite3'))
    databases.push(database)
    return database
  }

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('round-trips hierarchy, history, rich text, and Todo placement data', () => {
    const source = createDatabase('archive-source')
    const focus = source.domain.focuses.create({ title: 'Imported portfolio' }).toSnapshot()
    source.domain.focuses.setStatus(focus.id, 'paused')
    const thread = source.domain.threads.create({
      focusId: focus.id,
      title: 'Delivery health',
      reviewFrequencyDays: 14
    }).snapshot()
    const commitment = source.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'action',
      title: 'Improve ticket quality',
      dueDate: '2026-09-01'
    }).snapshot()
    source.domain.focuses.requireModel(focus.id)
      .pokeReview(new Date('2026-08-07T12:00:00.000Z'))
    source.domain.threads.requireModel(thread.id)
      .pokeReview(new Date('2026-08-08T12:00:00.000Z'))
    source.domain.commitments.requireModel(commitment.id)
      .pokeReview(new Date('2026-08-10T12:00:00.000Z'))
    source.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-08-09',
      observation: 'Examples are improving.',
      state: 'green'
    })
    const sourceTodo = source.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Review acceptance criteria',
      dueDate: '2026-08-10',
      done: true
    }, new Date('2026-08-09T10:00:00.000Z'))
    const defaultNote = source.domain.commitments.materialize(commitment.id).notes[0]
    source.domain.richTextDocuments.save(
      { type: 'note', id: defaultNote.id, field: 'content' },
      'Durable imported note'
    )

    const archive = source.dataArchive.export('9.9.9', new Date('2026-08-09T12:00:00.000Z'))
    expect(archive).toMatchObject({
      format: DATA_ARCHIVE_FORMAT,
      archiveVersion: 1,
      appVersion: '9.9.9',
      exportedAt: '2026-08-09T12:00:00.000Z'
    })
    expect(archive.tables.commitment_parent_transitions).toHaveLength(1)
    expect(archive.tables.thread_parent_transitions).toHaveLength(1)

    const target = createDatabase('archive-target')
    target.domain.focuses.create({ title: 'Replaced local data' })
    const summary = target.dataArchive.import(archive)

    expect(summary.issues).toEqual([])
    expect(summary).toMatchObject({ skippedRows: 0, ignoredTables: [], ignoredFields: [] })
    const importedFocus = target.domain.focuses.list()[0]
    expect(importedFocus).toMatchObject({
      title: 'Imported portfolio',
      status: 'paused',
      lastReviewDate: '2026-08-07'
    })
    expect(target.domain.focuses.statusHistory(importedFocus.id)).toHaveLength(2)
    const importedThread = target.domain.threads.listForFocus(importedFocus.id)[0]
    expect(importedThread).toMatchObject({
      title: 'Delivery health',
      reviewFrequencyDays: 14,
      lastReviewDate: '2026-08-08'
    })
    expect(target.domain.threads.requireModel(importedThread.id).parentHistory()).toMatchObject([{
      fromFocusId: null,
      toFocusId: importedFocus.id
    }])
    const importedCommitment = target.domain.commitments.listForThread(importedThread.id)[0]
    expect(importedCommitment).toMatchObject({
      title: 'Improve ticket quality',
      type: 'action',
      dueDate: '2026-09-01',
      state: 'green',
      lastReviewDate: '2026-08-10',
      lastUpdateDate: '2026-08-09'
    })
    expect(target.domain.commitments.requireModel(importedCommitment.id).parentHistory())
      .toMatchObject([{ from: null, to: { type: 'thread', id: importedThread.id } }])
    expect(target.domain.updates.listForCommitment(importedCommitment.id)[0].observation)
      .toBe('Examples are improving.')
    expect(target.domain.todos.list({ type: 'commitment', id: importedCommitment.id })[0])
      .toMatchObject({
        name: 'Review acceptance criteria',
        done: true,
        completedAt: sourceTodo.completedAt
      })
    expect(target.domain.commitments.materialize(importedCommitment.id).notes[0].content)
      .toBe('Durable imported note')
  })

  it('round-trips a Thread Focus move and its immutable parent history', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const source = createDatabase('archive-thread-move-source')
    const firstFocus = source.domain.focuses.create({ title: 'First portfolio' })
    const secondFocus = source.domain.focuses.create({ title: 'Second portfolio' })
    const thread = source.domain.threads.create({
      focusId: firstFocus.id,
      title: 'Delivery health',
      reviewFrequencyDays: 7
    }, now)
    source.domain.threads.move(thread.id, {
      focusId: secondFocus.id,
      plannedFromFocusId: firstFocus.id
    }, new Date('2026-08-10T13:00:00.000Z'))

    const archive = source.dataArchive.export('9.9.9', now)
    expect(archive.tables.thread_parent_transitions).toHaveLength(2)

    const target = createDatabase('archive-thread-move-target')
    expect(target.dataArchive.import(archive, now).issues).toEqual([])
    expect(target.domain.threads.listForFocus(firstFocus.id)).toEqual([])
    expect(target.domain.threads.listForFocus(secondFocus.id)).toMatchObject([{
      id: thread.id,
      title: 'Delivery health'
    }])
    expect(target.domain.threads.requireModel(thread.id).parentHistory()).toMatchObject([
      { fromFocusId: null, toFocusId: firstFocus.id },
      { fromFocusId: firstFocus.id, toFocusId: secondFocus.id }
    ])
  })

  it('round-trips shared Todos with independent Subject completion and placements', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const source = createDatabase('archive-shared-todo-source')
    const focus = source.domain.focuses.create({ title: 'Shared rollout' })
    const thread = source.domain.threads.create({
      focusId: focus.id,
      title: 'Regional readiness',
      reviewFrequencyDays: 7
    }, now)
    source.domain.threadScopes.addSubject(thread.id, { name: 'North' }, now)
    const scope = source.domain.threadScopes.addSubject(thread.id, { name: 'South' }, now)
    const north = scope.subjects.find(({ name }) => name === 'North')!
    const south = scope.subjects.find(({ name }) => name === 'South')!
    const shared = source.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Confirm launch readiness',
      sharedAcrossSubjects: true
    }, now)
    source.domain.todos.updateSubjectCompletion(shared.id, north.id, true, now)

    const archive = source.dataArchive.export('9.9.9', now)
    expect(archive.tables.todo_subject_completions).toHaveLength(2)

    const target = createDatabase('archive-shared-todo-target')
    expect(target.dataArchive.import(archive, now).issues).toEqual([])
    const importedThread = target.domain.threads.listForFocus(focus.id)[0]
    const imported = target.domain.todos.list(
      { type: 'thread', id: importedThread.id },
      {},
      now
    ).find(({ id }) => id === shared.id)!

    expect(imported).toMatchObject({
      sharedAcrossSubjects: true,
      done: false,
      subjectCompletions: [
        { subject: { id: north.id, name: 'North' }, done: true },
        { subject: { id: south.id, name: 'South' }, done: false }
      ]
    })
    expect(imported.sort).toHaveLength(3)
    expect(target.domain.todos.list({
      type: 'thread-scope',
      id: importedThread.id,
      scope: { scopeId: scope.scopeId!, subjectId: north.id }
    }, {}, now).map(({ id }) => id)).toContain(shared.id)
  })

  it('accepts older camelCase records and ignores future fields and tables', () => {
    const target = createDatabase('archive-compatible')
    const summary = target.dataArchive.import({
      format: DATA_ARCHIVE_FORMAT,
      archiveVersion: 99,
      schemaVersion: 999,
      tables: {
        focuses: [{
          id: '10',
          title: 'Older focus',
          kind: 'kind-added-by-another-version',
          status: 'status-added-by-another-version',
          futurePresentationHint: 'ignored'
        }],
        threads: [{
          id: 20,
          focusId: 10,
          title: 'Older thread'
        }],
        commitments: [{
          id: 30,
          threadId: 20,
          title: 'Older commitment'
        }],
        todos: [{
          id: 40,
          focusId: 10,
          name: 'Older completed Todo',
          done: true
        }],
        future_documents: [{ id: 1, blocks: [] }]
      }
    }, new Date('2026-08-09T12:00:00.000Z'))

    expect(summary.sourceArchiveVersion).toBe(99)
    expect(summary.sourceSchemaVersion).toBe(999)
    expect(summary.issues).toEqual([])
    expect(summary).toMatchObject({ candidateRows: 4, importedRows: 4, skippedRows: 0 })
    expect(summary.ignoredTables).toEqual(['future_documents'])
    expect(summary.ignoredFields).toContain('focuses.futurePresentationHint')
    expect(summary.repairedRows).toBeGreaterThan(0)

    const focus = target.domain.focuses.list()[0]
    expect(focus).toMatchObject({ id: 10, title: 'Older focus', kind: 'generic', status: 'active' })
    expect(focus.notes).toHaveLength(1)
    const thread = target.domain.threads.listForFocus(focus.id)[0]
    expect(thread).toMatchObject({ id: 20, title: 'Older thread', reviewFrequencyDays: 7 })
    expect(thread.notes).toHaveLength(1)
    const commitment = target.domain.commitments.listForThread(thread.id)[0]
    expect(commitment).toMatchObject({ id: 30, title: 'Older commitment', type: 'ongoing' })
    expect(commitment.notes).toHaveLength(1)
    expect(target.domain.todos.find(40)).toMatchObject({
      name: 'Older completed Todo',
      done: true,
      completedAt: '2026-08-09T12:00:00.000Z'
    })
    expect(target.domain.commitments.requireModel(commitment.id).parentHistory())
      .toMatchObject([{ from: null, to: { type: 'thread', id: thread.id } }])
  })

  it('keeps valid records while pruning broken relationships', () => {
    const target = createDatabase('archive-broken-relationships')
    const summary = target.dataArchive.import({
      tables: {
        focuses: [{ id: 1, title: 'Valid focus' }],
        threads: [
          { id: 2, focusId: 1, title: 'Valid thread', reviewFrequencyDays: 7 },
          { id: 3, focusId: 999, title: 'Orphaned thread', reviewFrequencyDays: 7 }
        ]
      }
    }, new Date('2026-08-09T12:00:00.000Z'))

    expect(summary.skippedRows).toBeGreaterThan(0)
    const focus = target.domain.focuses.list()[0]
    expect(target.domain.threads.listForFocus(focus.id).map(({ title }) => title))
      .toEqual(['Valid thread'])
  })

  it('rolls back data and trigger changes when no archive records are safe', () => {
    const target = createDatabase('archive-rollback')
    target.domain.focuses.create({ title: 'Keep me' })

    expect(() => target.dataArchive.import({ tables: { focuses: [null] } }))
      .toThrow('None of the records')
    expect(target.domain.focuses.list().map(({ title }) => title)).toEqual(['Keep me'])

    const createdAfterFailure = target.domain.focuses.create({ title: 'Triggers still work' })
      .toSnapshot()
    expect(createdAfterFailure.notes).toHaveLength(1)
    expect(target.domain.focuses.statusHistory(createdAfterFailure.id)).toHaveLength(1)
  })
})
