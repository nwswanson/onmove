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
      type: 'tracking',
      title: 'Improve ticket quality',
      dueDate: '2026-09-01'
    }).snapshot()
    const routine = source.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Inspect delivery evidence',
      scheduleWeekdays: ['monday'],
      checklist: [
        { inspection: 'Verify delivery risks were represented.' },
        { inspection: 'Confirm scope changes received approval.' }
      ]
    }, new Date('2026-08-10T08:00:00.000Z'))
    const routineRun = routine.snapshot('2026-08-10').currentRun!
    source.domain.routines.attestCellItem(routineRun.items[0].id, {
      resolution: 'attested',
      note: 'Reviewed the approval packet.',
      issueFound: true,
      issueDescription: 'Approval evidence was incomplete',
      issueFollowUpType: 'commitment'
    }, new Date('2026-08-10T09:00:00.000Z'))
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
      'A'.repeat(600)
    )
    source.domain.richTextDocuments.save(
      { type: 'note', id: defaultNote.id, field: 'content' },
      'Durable imported note'
    )
    source.domain.canvases.addEntityReference(1, {
      elementId: 'onmove_archived-thread-card',
      target: { type: 'thread', id: thread.id }
    })
    source.domain.canvases.addEntityReference(1, {
      elementId: 'onmove_archived-note-card',
      target: { type: 'note', id: defaultNote.id }
    })
    source.domain.canvases.saveDocument(1, {
      data: { type: 'excalidraw', elements: [{ id: 'durable-element' }] },
      entityElementIds: ['onmove_archived-thread-card', 'onmove_archived-note-card']
    })

    const archive = source.dataArchive.export('9.9.9', new Date('2026-08-09T12:00:00.000Z'))
    expect(archive).toMatchObject({
      format: DATA_ARCHIVE_FORMAT,
      archiveVersion: 1,
      appVersion: '9.9.9',
      exportedAt: '2026-08-09T12:00:00.000Z'
    })
    expect(archive.tables.commitment_parent_transitions).toHaveLength(2)
    expect(archive.tables.thread_parent_transitions).toHaveLength(1)
    expect(archive.tables.rich_text_history).toMatchObject([{
      document_type: 'note-content',
      entity_id: defaultNote.id,
      revision: 1,
      reason: 'large-edit'
    }])
    expect(archive.tables.rich_text_history_state).toEqual(expect.arrayContaining([
      expect.objectContaining({
        document_type: 'note-content',
        entity_id: defaultNote.id
      })
    ]))
    expect(archive.tables.canvases).toEqual([
      expect.objectContaining({ name: 'Default', revision: 1 })
    ])
    expect(archive.tables.canvas_entity_references).toHaveLength(2)

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
    expect(target.domain.canvases.get(1)).toMatchObject({
      name: 'Default',
      revision: 1,
      data: { type: 'excalidraw', elements: [{ id: 'durable-element' }] },
      references: expect.arrayContaining([
        expect.objectContaining({
          elementId: 'onmove_archived-thread-card',
          target: { type: 'thread', id: importedThread.id },
          deleted: false
        }),
        expect.objectContaining({ elementId: 'onmove_archived-note-card', deleted: false })
      ])
    })
    const importedCommitment = target.domain.commitments.listForThread(importedThread.id)[0]
    expect(importedCommitment).toMatchObject({
      title: 'Improve ticket quality',
      type: 'tracking',
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
    const [importedNote] = target.domain.commitments.materialize(importedCommitment.id).notes
    expect(importedNote.content).toBe('Durable imported note')
    expect(target.domain.richTextDocuments.history({
      type: 'note', id: importedNote.id, field: 'content'
    })).toMatchObject([{
      revision: 1,
      value: 'A'.repeat(600),
      reason: 'large-edit'
    }])
    const importedRoutine = target.domain.routines.list('2026-08-09')[0]
    expect(importedRoutine).toMatchObject({
      id: routine.id,
      type: 'routine',
      name: 'Inspect delivery evidence',
      currentRun: {
        templateVersion: 1,
        progress: { complete: 1, required: 2 }
      }
    })
    expect(importedRoutine.currentRun!.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        note: 'Reviewed the approval packet.',
        issue: expect.objectContaining({ followUpType: 'commitment' })
      })
    ]))
  })

  it('upgrades aggregate Routine Runs from a pre-cell portable archive', () => {
    const source = createDatabase('archive-routine-v27-source')
    const focus = source.domain.focuses.create({ title: 'Older Routine focus' })
    const thread = source.domain.threads.create({
      focusId: focus.id,
      title: 'Older Routine Thread',
      reviewFrequencyDays: 7
    })
    const routine = source.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Inspect older evidence',
      scheduleWeekdays: ['monday'],
      checklist: [{ inspection: 'Verify the evidence was inspected.' }]
    }, new Date('2026-08-10T08:00:00.000Z'))
    const run = routine.snapshot('2026-08-10').currentRun!
    const archive = source.dataArchive.export('1.0.0', new Date('2026-08-10T09:00:00.000Z'))

    archive.schemaVersion = 27
    archive.tables.routine_review_run_items[0].resolution = 'attested'
    archive.tables.routine_review_run_items[0].attested_at = '2026-08-10T09:00:00.000Z'
    archive.tables.routine_review_runs[0].completed_at = '2026-08-10T09:00:00.000Z'
    archive.tables.routine_run_issues.push({
      id: 1,
      run_item_id: run.items[0].runItemId,
      description: 'Older issue evidence',
      follow_up_type: 'update',
      created_at: '2026-08-10T09:00:00.000Z',
      updated_at: '2026-08-10T09:00:00.000Z'
    })
    const tables = archive.tables as unknown as Record<string, unknown>
    delete tables.routine_review_cells
    delete tables.routine_review_cell_attestations
    delete tables.routine_review_cell_issues

    const target = createDatabase('archive-routine-v27-target')
    const summary = target.dataArchive.import(archive, new Date('2026-08-10T10:00:00.000Z'))
    const imported = target.domain.routines.list('2026-08-10')[0]
    const migratedRun = imported.previousRuns.find(
      ({ scheduledDate }) => scheduledDate === '2026-08-10'
    )

    expect(summary.issues).toEqual([])
    expect(summary.repairedRows).toBeGreaterThan(0)
    expect(imported.currentRun).toMatchObject({
      scheduledDate: '2026-08-17',
      completionDate: null
    })
    expect(migratedRun).toMatchObject({
      completionDate: '2026-08-10',
      progress: { complete: 1, required: 1 },
      cells: [{
        subject: null,
        progress: { complete: 1, required: 1 },
        items: [{
          resolution: 'attested',
          note: '',
          issue: { description: 'Older issue evidence', followUpType: 'update' }
        }]
      }]
    })
  })

  it('exports rescued Updates and merges them with Updates archived by replacement import', () => {
    const now = new Date('2026-08-12T12:00:00.000Z')
    const source = createDatabase('archive-rescued-update-source')
    const sourceFocus = source.domain.focuses.create({ title: 'Imported focus' })
    const sourceThread = source.domain.threads.create({
      focusId: sourceFocus.id,
      title: 'Imported Thread',
      reviewFrequencyDays: 7
    })
    const sourceDeleted = source.domain.updates.create({
      parent: { type: 'thread', id: sourceThread.id },
      observation: 'Already rescued evidence'
    }, now)
    source.domain.updates.delete(sourceDeleted.id)
    const archive = source.dataArchive.export('9.9.9', now)
    expect(archive.tables.archived_updates).toHaveLength(1)

    const target = createDatabase('archive-rescued-update-target')
    const targetFocus = target.domain.focuses.create({ title: 'Outgoing local focus' })
    const targetThread = target.domain.threads.create({
      focusId: targetFocus.id,
      title: 'Outgoing local Thread',
      reviewFrequencyDays: 7
    })
    const outgoing = target.domain.updates.create({
      parent: { type: 'thread', id: targetThread.id },
      observation: 'Archive me during replacement'
    }, now)

    expect(target.dataArchive.import(archive, now).issues).toEqual([])
    expect(target.domain.archivedUpdates.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        originalUpdateId: sourceDeleted.id,
        observation: 'Already rescued evidence'
      }),
      expect.objectContaining({
        originalUpdateId: outgoing.id,
        observation: 'Archive me during replacement'
      })
    ]))
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
    source.domain.threads.requireModel(thread.id).pokeReview(now, {
      scopeId: scope.scopeId!,
      subjectId: north.id
    })
    const shared = source.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Confirm launch readiness',
      sharedAcrossSubjects: true
    }, now)
    source.domain.todos.updateSubjectCompletion(shared.id, north.id, true, now)

    const archive = source.dataArchive.export('9.9.9', now)
    expect(archive.tables.todo_subject_completions).toHaveLength(2)
    expect(archive.tables.thread_review_cell_pokes).toHaveLength(1)

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
    expect(target.domain.threads.requireModel(importedThread.id).scopeMatrix('2026-08-10'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ subjectId: north.id, lastReviewDate: '2026-08-10' })
      ]))
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
          description: 'Legacy rich description',
          descriptionRevision: 1,
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
          commitmentType: 'action',
          title: 'Older commitment',
          dueOn: '2026-09-15'
        }],
        todos: [{
          id: 40,
          threadId: 20,
          name: 'Older completed Todo',
          done: true
        }],
        rich_text_history: [{
          documentType: 'focus-description',
          entityId: 10,
          revision: 1,
          value: 'Legacy rich description',
          changedAt: '2026-08-08T12:00:00.000Z'
        }],
        future_documents: [{ id: 1, blocks: [] }]
      }
    }, new Date('2026-08-09T12:00:00.000Z'))

    expect(summary.sourceArchiveVersion).toBe(99)
    expect(summary.sourceSchemaVersion).toBe(999)
    expect(summary.issues).toEqual([])
    expect(summary).toMatchObject({ candidateRows: 5, importedRows: 5, skippedRows: 0 })
    expect(summary.ignoredTables).toEqual(['future_documents'])
    expect(summary.ignoredFields).toContain('focuses.futurePresentationHint')
    expect(summary.repairedRows).toBeGreaterThan(0)
    expect(target.domain.canvases.list()).toEqual([
      expect.objectContaining({ name: 'Default', revision: 0 })
    ])

    const focus = target.domain.focuses.list()[0]
    expect(focus).toMatchObject({ id: 10, title: 'Older focus', kind: 'generic', status: 'active' })
    expect(focus.notes).toHaveLength(1)
    expect(target.domain.richTextDocuments.history({
      type: 'focus', id: focus.id, field: 'description'
    })).toMatchObject([{
      revision: 1,
      value: 'Legacy rich description',
      reason: 'legacy',
      editCount: 1,
      changeSize: 0
    }])
    const thread = target.domain.threads.listForFocus(focus.id)[0]
    expect(thread).toMatchObject({ id: 20, title: 'Older thread', reviewFrequencyDays: 7 })
    expect(thread.notes).toHaveLength(1)
    const commitment = target.domain.commitments.listForThread(thread.id)[0]
    expect(commitment).toMatchObject({
      id: 30,
      title: 'Older commitment',
      type: 'tracking',
      dueDate: '2026-09-15'
    })
    expect(commitment.notes).toHaveLength(1)
    expect(target.domain.todos.find(40)).toMatchObject({
      name: 'Older completed Todo',
      done: true,
      completedAt: '2026-08-09T12:00:00.000Z'
    })
    expect(target.domain.commitments.requireModel(commitment.id).parentHistory())
      .toMatchObject([{ from: null, to: { type: 'thread', id: thread.id } }])
  })

  it('retires Focus-owned work from older archives and rescues its Updates', () => {
    const target = createDatabase('archive-focus-overview-retirement')
    const summary = target.dataArchive.import({
      format: DATA_ARCHIVE_FORMAT,
      archiveVersion: 1,
      schemaVersion: 32,
      tables: {
        focuses: [{
          id: 1,
          title: 'Legacy overview',
          goal: 'Legacy goal',
          kind: 'generic',
          status: 'active'
        }],
        threads: [{
          id: 2,
          focusId: 1,
          title: 'Surviving Thread',
          reviewFrequencyDays: 7,
          status: 'active'
        }],
        commitments: [{
          id: 3,
          focusId: 1,
          commitmentType: 'tracking',
          behaviorType: 'tracking',
          title: 'Legacy Focus commitment',
          status: 'active'
        }],
        updates: [
          {
            id: 4,
            focusId: 1,
            recordedOn: '2026-08-08',
            observation: 'Legacy direct evidence',
            state: 'yellow'
          },
          {
            id: 5,
            commitmentId: 3,
            recordedOn: '2026-08-09',
            observation: 'Legacy nested evidence',
            state: 'red'
          }
        ],
        todos: [{ id: 6, focusId: 1, name: 'Legacy Focus Todo', done: false }]
      }
    }, new Date('2026-08-10T12:00:00.000Z'))

    expect(summary.skippedRows).toBeGreaterThanOrEqual(4)
    expect(target.dataArchive.export('test').tables.focuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, goal: '' })
    ]))
    expect(target.domain.threads.listForFocus(1)).toMatchObject([{
      id: 2,
      title: 'Surviving Thread'
    }])
    expect(target.domain.commitments.find(3)).toBeNull()
    expect(target.domain.todos.find(6)).toBeNull()
    expect(target.domain.updates.find(4)).toBeNull()
    expect(target.domain.updates.find(5)).toBeNull()
    expect(target.domain.archivedUpdates.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        originalUpdateId: 4,
        observation: 'Legacy direct evidence',
        context: expect.objectContaining({ focusTitle: 'Legacy overview' })
      }),
      expect.objectContaining({
        originalUpdateId: 5,
        observation: 'Legacy nested evidence',
        context: expect.objectContaining({ commitmentTitle: 'Legacy Focus commitment' })
      })
    ]))
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
