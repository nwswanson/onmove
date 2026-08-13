import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { ModelNotFoundError, ModelValidationError } from '../../src/main/data/model'

describe('Routine Commitment model', () => {
  let directory: string
  let path: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-routine-test-'))
    path = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(path)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  function createRoutine(overrides: Record<string, unknown> = {}) {
    const focus = database!.domain.focuses.create({ title: 'Project delivery' })
    const routine = database!.domain.routines.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Weekly delivery inspection',
      scheduleWeekdays: ['thursday'],
      checklist: [
        { inspection: 'Verify delivery risks are represented in the weekly update.' },
        { inspection: 'Confirm scope changes received approval.' }
      ],
      ...overrides
    }, new Date('2026-01-01T12:00:00.000Z'))
    return { focus, routine }
  }

  it('stores Routine as a generic Commitment without leaking it into tracking lists', () => {
    const { focus, routine } = createRoutine()

    expect(routine.snapshot('2026-01-01')).toMatchObject({
      parent: { type: 'focus', id: focus.id },
      type: 'routine',
      name: 'Weekly delivery inspection',
      status: 'green',
      nextReviewDate: '2026-01-01',
      currentRun: {
        scheduledDate: '2026-01-01',
        templateVersion: 1,
        progress: { complete: 0, required: 2 }
      }
    })
    expect(database!.domain.commitments.listForFocus(focus.id)).toEqual([])
    expect(database!.domain.commitments.find(routine.id)).toBeNull()
    expect(database!.domain.routines.list('2026-01-01')).toHaveLength(1)

    const raw = new DatabaseSync(path)
    expect(raw.prepare(
      'SELECT commitment_type, behavior_type FROM commitments WHERE id = ?'
    ).get(routine.id)).toMatchObject({
      commitment_type: 'tracking',
      behavior_type: 'routine'
    })
    raw.close()
  })

  it('derives current, overdue, and lapsed exclusively from full Run completion', () => {
    const { routine } = createRoutine()
    const first = routine.snapshot('2026-01-02')
    expect(first).toMatchObject({ status: 'yellow', overdueDays: 1 })

    const [firstItem, secondItem] = first.currentRun!.items
    const partial = database!.domain.routines.attestCellItem(firstItem.id, {
      resolution: 'attested',
      issueFound: true,
      issueDescription: 'Risk entry was stale',
      issueFollowUpType: 'update'
    }, new Date('2026-01-02T12:00:00.000Z'))
    expect(partial).toMatchObject({
      status: 'yellow',
      currentRun: { completionDate: null, progress: { complete: 1, required: 2 } }
    })
    expect(partial.currentRun!.items[0].issue).toMatchObject({
      description: 'Risk entry was stale',
      followUpType: 'update'
    })
    const noted = database!.domain.routines.attestCellItem(firstItem.id, {
      resolution: 'attested',
      note: 'Legacy discovery retained with this note.'
    }, new Date('2026-01-02T12:30:00.000Z'))
    expect(noted.currentRun!.items[0]).toMatchObject({
      note: 'Legacy discovery retained with this note.',
      issue: { description: 'Risk entry was stale', followUpType: 'update' }
    })

    const ready = database!.domain.routines.attestCellItem(secondItem.id, {
      resolution: 'not_applicable'
    }, new Date('2026-01-02T13:00:00.000Z'))
    expect(ready).toMatchObject({
      status: 'yellow',
      currentRun: { completionDate: null, progress: { complete: 2, required: 2 } }
    })
    const complete = database!.domain.routines.finalizeCell(
      ready.currentRun!.cells[0].id,
      new Date('2026-01-02T13:05:00.000Z')
    )
    expect(complete).toMatchObject({
      status: 'green',
      nextReviewDate: '2026-01-08',
      currentRun: { completionDate: '2026-01-02', progress: { complete: 2, required: 2 } }
    })

    expect(routine.snapshot('2026-01-15').status).toBe('red')
  })

  it('anchors recurrence and preserves lateness when a missed Run is completed', () => {
    const { routine } = createRoutine({
      checklist: [{ inspection: 'Verify the weekly report was inspected.' }]
    })
    const first = routine.snapshot('2026-01-01').currentRun!
    database!.domain.routines.attestCellItem(first.items[0].id, {
      resolution: 'attested'
    }, new Date('2026-01-09T12:00:00.000Z'))
    database!.domain.routines.finalizeCell(
      first.cells[0].id,
      new Date('2026-01-09T12:00:00.000Z')
    )

    const finalized = routine.snapshot('2026-01-09')
    const preserved = finalized.previousRuns.find(({ id }) => id === first.id)
    expect(preserved).toMatchObject({
      scheduledDate: '2026-01-01',
      reviewWindowEndsDate: '2026-01-08',
      completionDate: '2026-01-09',
      completedLate: true
    })
    expect(finalized.currentRun).toMatchObject({ scheduledDate: '2026-01-08', completionDate: null })
    expect(finalized.nextReviewDate).toBe('2026-01-08')
    expect(finalized.status).toBe('yellow')
  })

  it('creates anchored weekday Runs and advances the oldest unfinished occurrence first', () => {
    const { routine } = createRoutine({
      scheduleWeekdays: ['monday', 'wednesday', 'friday'],
      checklist: [{ inspection: 'Verify the scheduled evidence was inspected.' }]
    })

    const projected = routine.snapshot('2026-01-09')
    expect(projected).toMatchObject({
      scheduleWeekdays: ['monday', 'wednesday', 'friday'],
      attestationRequested: true,
      needsAttestation: true,
      currentRun: { scheduledDate: '2026-01-02' },
      nextScheduledDate: '2026-01-12'
    })
    const raw = new DatabaseSync(path)
    expect(raw.prepare(
      `SELECT scheduled_on, review_window_ends_on
       FROM routine_review_runs WHERE routine_id = ? ORDER BY scheduled_on`
    ).all(routine.id)).toEqual([
      { scheduled_on: '2026-01-02', review_window_ends_on: '2026-01-05' },
      { scheduled_on: '2026-01-05', review_window_ends_on: '2026-01-07' },
      { scheduled_on: '2026-01-07', review_window_ends_on: '2026-01-09' },
      { scheduled_on: '2026-01-09', review_window_ends_on: '2026-01-12' }
    ])
    raw.close()
  })

  it('derives queue inclusion from both the stored preference and a nonempty schedule', () => {
    const { routine } = createRoutine({ scheduleWeekdays: [] })
    expect(routine.snapshot('2026-01-08')).toMatchObject({
      scheduleWeekdays: [],
      attestationRequested: true,
      needsAttestation: false,
      status: 'green',
      nextReviewDate: null,
      nextScheduledDate: null,
      currentRun: null
    })

    const scheduled = database!.domain.routines.update(routine.id, {
      scheduleWeekdays: ['thursday']
    }, new Date('2026-01-08T09:00:00.000Z'))
    expect(scheduled).toMatchObject({
      attestationRequested: true,
      needsAttestation: true,
      currentRun: { scheduledDate: '2026-01-08' }
    })

    const excluded = database!.domain.routines.update(routine.id, {
      needsAttestation: false
    }, new Date('2026-01-08T10:00:00.000Z'))
    expect(excluded).toMatchObject({
      attestationRequested: false,
      needsAttestation: false,
      scheduleWeekdays: ['thursday'],
      status: 'green'
    })
  })

  it('autosaves draft rich-text notes and freezes them only through explicit finalization', () => {
    const { routine } = createRoutine({
      checklist: [{ inspection: 'Verify the evidence was reviewed.' }]
    })
    const item = routine.snapshot('2026-01-01').currentRun!.items[0]
    const firstNote = 'onmove-rich-text:1:{"root":{"children":[]}}'
    const drafted = database!.domain.routines.attestCellItem(item.id, {
      resolution: 'pending',
      note: firstNote
    }, new Date('2026-01-01T12:15:00.000Z'))
    expect(drafted.currentRun!.items[0]).toMatchObject({
      resolution: 'pending',
      note: firstNote,
      attestedAt: null
    })

    const ready = database!.domain.routines.attestCellItem(item.id, {
      resolution: 'attested'
    }, new Date('2026-01-01T12:30:00.000Z'))
    const recordedAt = ready.currentRun!.items[0].attestedAt
    expect(ready.currentRun).toMatchObject({ completionDate: null })
    expect(ready.currentRun!.items[0].note).toBe(firstNote)

    const revised = database!.domain.routines.attestCellItem(item.id, {
      resolution: 'attested',
      note: 'Clarified after completion.'
    }, new Date('2026-01-02T12:00:00.000Z'))
    expect(revised.currentRun!.items[0]).toMatchObject({
      resolution: 'attested',
      attestedAt: recordedAt,
      note: 'Clarified after completion.'
    })
    const finalized = database!.domain.routines.finalizeCell(
      revised.currentRun!.cells[0].id,
      new Date('2026-01-02T12:05:00.000Z')
    )
    expect(finalized.currentRun).toMatchObject({ completionDate: '2026-01-02' })
    expect(() => database!.domain.routines.attestCellItem(item.id, {
      resolution: 'attested',
      note: 'Finalized notes should fail.'
    })).toThrow(/Finalized.*cannot be changed/)
  })

  it('rejects finalization until every required inspection is resolved', () => {
    const { routine } = createRoutine()
    const run = routine.snapshot('2026-01-01').currentRun!
    expect(() => database!.domain.routines.finalizeCell(run.cells[0].id))
      .toThrow(/Every required Routine inspection/)
    database!.domain.routines.attestCellItem(run.items[0].id, { resolution: 'attested' })
    expect(() => database!.domain.routines.finalizeCell(run.cells[0].id))
      .toThrow(/Every required Routine inspection/)
  })

  it('versions templates and never rewrites an already materialized Run checklist', () => {
    const { routine } = createRoutine()
    const original = routine.snapshot('2026-01-01').currentRun!
    for (const item of original.items) {
      database!.domain.routines.attestCellItem(
        item.id,
        { resolution: 'attested' },
        new Date('2026-01-01T12:30:00.000Z')
      )
    }
    database!.domain.routines.finalizeCell(
      original.cells[0].id,
      new Date('2026-01-01T13:00:00.000Z')
    )

    database!.domain.routines.update(routine.id, {
      checklist: [{ inspection: 'Verify the replacement inspection was performed.' }]
    }, new Date('2026-01-02T12:00:00.000Z'))
    const next = routine.snapshot('2026-01-08')

    expect(next.template).toMatchObject({ version: 2 })
    expect(next.currentRun).toMatchObject({ templateVersion: 2, scheduledDate: '2026-01-08' })
    expect(next.currentRun!.items.map(({ inspection }) => inspection)).toEqual([
      'Verify the replacement inspection was performed.'
    ])
    expect(next.previousRuns.find(({ id }) => id === original.id)).toMatchObject({
      templateVersion: 1,
      items: [
        { inspection: 'Verify delivery risks are represented in the weekly update.' },
        { inspection: 'Confirm scope changes received approval.' }
      ]
    })

    const raw = new DatabaseSync(path)
    expect(() => raw.prepare(
      'UPDATE routine_review_run_items SET inspection = ? WHERE id = ?'
    ).run('Rewritten', original.items[0].runItemId)).toThrow(/immutable/)
    expect(() => raw.prepare(
      'UPDATE routine_review_cells SET subject_name = ? WHERE id = ?'
    ).run('Rewritten Subject', original.cells[0].id)).toThrow(/immutable/)
    expect(() => raw.prepare(
      'DELETE FROM routine_review_cell_attestations WHERE id = ?'
    ).run(original.cells[0].items[0].id)).toThrow(/immutable/)
    raw.close()
  })

  it('captures optional Scope membership in each Run without making issue state affect color', () => {
    const focus = database!.domain.focuses.create({ title: 'Scoped delivery' })
    const focusScope = database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'North America' },
      new Date('2026-01-01T09:00:00.000Z')
    )
    const twoSubjectScope = database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'Europe' },
      new Date('2026-01-01T09:30:00.000Z')
    )
    const routine = database!.domain.routines.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Regional inspection',
      scheduleWeekdays: ['thursday'],
      scopeId: focusScope.scopeId,
      checklist: [{ inspection: 'Confirm the regional plan was inspected.' }]
    }, new Date('2026-01-01T12:00:00.000Z'))
    const run = routine.snapshot('2026-01-01').currentRun!
    expect(run.scope?.id).toBe(focusScope.scopeId)
    expect(run.scope?.subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Europe' }),
      expect.objectContaining({ name: 'North America' })
    ]))
    expect(run.cells.map((cell) => cell.subject?.name)).toEqual(['Europe', 'North America'])

    const firstSubjectComplete = database!.domain.routines.attestCellItem(
      run.cells[0].items[0].id,
      { resolution: 'attested', issueFound: true, issueDescription: 'Evidence was stale' },
      new Date('2026-01-02T10:00:00.000Z')
    )
    expect(firstSubjectComplete.currentRun).toMatchObject({
      completionDate: null,
      progress: { complete: 1, required: 2 }
    })
    expect(firstSubjectComplete.currentRun!.cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: expect.objectContaining({ name: 'Europe' }), completionDate: null }),
      expect.objectContaining({ subject: expect.objectContaining({ name: 'North America' }), completionDate: null })
    ]))
    const finalizedSubject = database!.domain.routines.finalizeCell(
      run.cells[0].id,
      new Date('2026-01-02T10:05:00.000Z')
    )
    expect(finalizedSubject.currentRun!.cells).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subject: expect.objectContaining({ name: 'Europe' }),
        completionDate: '2026-01-02'
      })
    ]))

    database!.domain.focusScopes.removeSubject(
      focus.id,
      focusScope.subjects[0].id,
      new Date('2026-01-02T12:00:00.000Z')
    )
    const afterScopeChange = routine.snapshot('2026-01-02')
    expect(afterScopeChange.currentRun!.scope?.subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Europe' }),
      expect.objectContaining({ name: 'North America' })
    ]))
    expect(twoSubjectScope.scopeId).toBe(focusScope.scopeId)
  })

  it('excludes a Routine from attestation status without deleting immutable history', () => {
    const { routine } = createRoutine()
    const originalRunId = routine.snapshot('2026-01-02').currentRun!.id

    const excluded = database!.domain.routines.update(routine.id, {
      needsAttestation: false,
      sensitive: true
    }, new Date('2026-01-02T12:00:00.000Z'))

    expect(excluded).toMatchObject({
      needsAttestation: false,
      sensitive: true,
      status: 'green'
    })
    expect(excluded.currentRun?.id).toBe(originalRunId)
  })

  it('validates parent, Scope, checklist, and attestation invariants', () => {
    const focus = database!.domain.focuses.create({ title: 'First focus' })
    const other = database!.domain.focuses.create({ title: 'Other focus' })
    const otherScope = database!.domain.focusScopes.addSubject(other.id, { name: 'Other subject' })

    expect(() => database!.domain.routines.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Invalid scope',
      scheduleWeekdays: ['thursday'],
      scopeId: otherScope.scopeId,
      checklist: [{ inspection: 'Verify ownership.' }]
    })).toThrow(/Scope must belong/)
    expect(() => database!.domain.routines.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Empty',
      scheduleWeekdays: ['thursday'],
      checklist: []
    })).toThrow(ModelValidationError)
    expect(() => database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'routine',
      title: 'Wrong repository'
    } as never)).toThrow(/Routine repository/)
    expect(() => database!.domain.routines.attestCellItem(9999, {
      resolution: 'attested'
    })).toThrow(ModelNotFoundError)
  })

  it('cascades complete Routine history with its owning Focus or Thread', () => {
    const { focus, routine } = createRoutine()
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const threadRoutine = database!.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Sprint inspection',
      scheduleWeekdays: ['thursday'],
      checklist: [{ inspection: 'Confirm sprint readiness was inspected.' }]
    })

    expect(database!.domain.threads.delete(thread.id)).toBe(true)
    expect(database!.domain.routines.find(threadRoutine.id)).toBeNull()
    expect(database!.domain.focuses.delete(focus.id)).toBe(true)
    expect(database!.domain.routines.find(routine.id)).toBeNull()
  })

  it('moves a Thread Routine Scope while preserving historical Run attribution', () => {
    const sourceFocus = database!.domain.focuses.create({ title: 'Source focus' })
    const targetFocus = database!.domain.focuses.create({ title: 'Target focus' })
    const sourceScope = database!.domain.focusScopes.addSubject(
      sourceFocus.id,
      { name: 'North region' },
      new Date('2026-01-01T08:00:00.000Z')
    )
    const thread = database!.domain.threads.create({
      focusId: sourceFocus.id,
      title: 'Regional delivery',
      reviewFrequencyDays: 7
    }, new Date('2026-01-01T09:00:00.000Z'))
    const routine = database!.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Regional inspection',
      scheduleWeekdays: ['thursday'],
      scopeId: sourceScope.scopeId,
      checklist: [{ inspection: 'Verify regional delivery evidence.' }]
    }, new Date('2026-01-01T10:00:00.000Z'))
    const historicalScopeId = routine.snapshot('2026-01-01').currentRun!.scope!.id
    const plan = database!.domain.threads.planMove(thread.id, targetFocus.id, '2026-01-01')

    database!.domain.threads.move(thread.id, {
      focusId: targetFocus.id,
      plannedFromFocusId: sourceFocus.id,
      confirmedScopeSubjectIds: plan.scopeSubjectAdditions.map(({ id }) => id)
    }, new Date('2026-01-01T12:00:00.000Z'))

    const moved = routine.snapshot('2026-01-01')
    expect(moved.parent).toEqual({ type: 'thread', id: thread.id })
    expect(moved.scope?.id).not.toBe(historicalScopeId)
    expect(moved.currentRun?.scope).toMatchObject({
      id: historicalScopeId,
      subjects: [{ name: 'North region' }]
    })
  })
})
