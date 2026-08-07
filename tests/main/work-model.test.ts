import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { ModelNotFoundError, ModelValidationError } from '../../src/main/data/model'

describe('Thread, Commitment, and Update models', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-work-model-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates multiple top-level threads for a focus with derived review state', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const sprint = database!.domain.threads.create(
      { focusId: focus.id, title: 'Sprint execution', reviewFrequencyDays: 7 },
      new Date('2026-01-01T12:00:00.000Z')
    )
    database!.domain.threads.create(
      { focusId: focus.id, title: 'Team health', reviewFrequencyDays: 14 },
      new Date('2026-01-01T12:00:00.000Z')
    )

    expect(database!.domain.threads.listForFocus(focus.id, '2026-01-07')).toHaveLength(2)
    expect(sprint.snapshot('2026-01-07')).toMatchObject({
      focusId: focus.id,
      title: 'Sprint execution',
      health: 'none',
      status: 'active',
      reviewFrequencyDays: 7,
      lastReviewDate: null,
      nextReviewDate: '2026-01-08',
      needsReview: false
    })
    expect(sprint.snapshot('2026-01-08').needsReview).toBe(true)
  })

  it('does not let active threads block closing their parent focus', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })

    focus.setStatus('done')

    expect(focus.status).toBe('done')
    expect(database!.domain.threads.requireModel(thread.id).status).toBe('active')
  })

  it('parents commitments to exactly one focus or thread and supports both commitment types', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const action = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'action',
      title: 'Improve ticket quality',
      dueDate: '2026-02-15'
    })
    const ongoing = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Weekly stakeholder alignment',
      cadenceDays: 7
    })

    expect(action.snapshot('2026-02-01')).toMatchObject({
      parent: { type: 'thread', id: thread.id },
      type: 'action',
      dueDate: '2026-02-15',
      state: 'none'
    })
    expect(ongoing.snapshot('2026-02-01')).toMatchObject({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      cadenceDays: 7
    })
    expect(database!.domain.commitments.listForThread(thread.id)).toHaveLength(1)
    expect(database!.domain.commitments.listForFocus(focus.id)).toHaveLength(1)
  })

  it('allows dated updates on focuses, threads, and commitments with today as the default', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Improve ticket quality'
    })

    const focusUpdate = database!.domain.updates.create(
      { parent: { type: 'focus', id: focus.id }, observation: 'Project started', state: 'green' },
      new Date('2026-03-12T12:00:00.000Z')
    )
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2025-12-01',
      observation: 'Backdated baseline',
      state: 'yellow'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2027-01-01',
      observation: 'Forward plan',
      state: 'none'
    })

    expect(focusUpdate.toSnapshot()).toMatchObject({
      parent: { type: 'focus', id: focus.id },
      date: '2026-03-12',
      state: 'green'
    })
    expect(database!.domain.updates.listForThread(thread.id)[0].date).toBe('2025-12-01')
    expect(database!.domain.updates.listForCommitment(commitment.id)[0].date).toBe('2027-01-01')
  })

  it('edits and deletes persisted updates without changing their parent', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Improve ticket quality'
    })
    const update = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-10',
      observation: 'Ticket quality is uneven',
      state: 'yellow'
    })

    update.update({
      date: '2026-01-11',
      observation: 'Acceptance criteria are now consistent',
      state: 'green'
    })

    expect(update.toSnapshot()).toMatchObject({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-11',
      observation: 'Acceptance criteria are now consistent',
      state: 'green'
    })
    expect(commitment.snapshot('2026-01-11').state).toBe('green')
    expect(update.delete()).toBe(true)
    expect(database!.domain.updates.listForCommitment(commitment.id)).toEqual([])
    expect(() => update.update({ state: 'red' })).toThrow('has been deleted')
  })

  it('derives thread health from the latest direct update and active commitment states', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-01',
      observation: 'Sprint is healthy',
      state: 'green'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('green')

    const quality = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Improve ticket quality'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('none')
    database!.domain.updates.create({
      parent: { type: 'commitment', id: quality.id },
      date: '2026-01-01',
      observation: 'Acceptance criteria are now consistent',
      state: 'green'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('green')

    const refinement = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Weekly refinement'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: refinement.id },
      date: '2026-01-01',
      observation: 'Several tickets still need work',
      state: 'yellow'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('yellow')

    const blocker = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'action',
      title: 'Remove test environment blocker'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: blocker.id },
      date: '2026-01-01',
      observation: 'Environment is unavailable',
      state: 'red'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('red')

    blocker.setStatus('paused')
    expect(thread.snapshot('2026-01-01').health).toBe('yellow')
    refinement.setStatus('done')
    expect(thread.snapshot('2026-01-01').health).toBe('green')
  })

  it('uses effective date and then insertion order to derive the latest commitment state', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Maintain project clarity'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-10',
      observation: 'Clarity improved',
      state: 'green'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-05',
      observation: 'Earlier ambiguity',
      state: 'red'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-10',
      observation: 'Newest same-day observation',
      state: 'yellow'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2027-01-01',
      observation: 'Future observation',
      state: 'red'
    })

    expect(commitment.snapshot('2026-01-06').state).toBe('red')
    expect(commitment.snapshot('2026-01-10')).toMatchObject({
      state: 'yellow',
      lastUpdateDate: '2026-01-10'
    })
    expect(commitment.snapshot('2026-12-31').state).toBe('yellow')
    expect(commitment.snapshot('2027-01-01').state).toBe('red')
  })

  it('changes last review only when a direct thread update is recorded', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create(
      { focusId: focus.id, title: 'Sprint execution', reviewFrequencyDays: 7 },
      new Date('2026-01-01T12:00:00.000Z')
    )
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Improve ticket quality'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-03',
      observation: 'Tickets reviewed',
      state: 'green'
    })

    expect(thread.snapshot('2026-01-09')).toMatchObject({
      lastReviewDate: null,
      nextReviewDate: '2026-01-08',
      needsReview: true
    })
    thread.snapshot('2026-01-09')
    expect(thread.snapshot('2026-01-09').lastReviewDate).toBeNull()

    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-03',
      observation: 'Sprint review completed',
      state: 'green'
    })
    expect(thread.snapshot('2026-01-09')).toMatchObject({
      lastReviewDate: '2026-01-03',
      nextReviewDate: '2026-01-10',
      needsReview: false
    })
    expect(thread.snapshot('2026-01-10').needsReview).toBe(true)
  })

  it('derives cadence deadlines from the latest effective commitment update', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const commitment = database!.domain.commitments.create(
      {
        parent: { type: 'focus', id: focus.id },
        type: 'ongoing',
        title: 'Weekly refinement',
        cadenceDays: 7
      },
      new Date('2026-01-01T12:00:00.000Z')
    )

    expect(commitment.snapshot('2026-01-07')).toMatchObject({
      lastUpdateDate: null,
      nextUpdateDate: '2026-01-08',
      needsUpdate: false
    })
    expect(commitment.snapshot('2026-01-08').needsUpdate).toBe(true)

    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-08',
      observation: 'Refinement completed',
      state: 'green'
    })
    expect(commitment.snapshot('2026-01-14')).toMatchObject({
      nextUpdateDate: '2026-01-15',
      needsUpdate: false
    })
    expect(commitment.snapshot('2026-01-15').needsUpdate).toBe(true)
    commitment.setStatus('paused')
    expect(commitment.snapshot('2026-01-15').needsUpdate).toBe(false)
  })

  it('audits thread and commitment lifecycle transitions without duplicate events', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'action',
      title: 'Improve ticket quality'
    })

    thread.setStatus('paused').setStatus('active').setStatus('active')
    commitment.setStatus('done').setStatus('done')

    expect(thread.statusHistory()).toMatchObject([
      { from: null, to: 'active' },
      { from: 'active', to: 'paused' },
      { from: 'paused', to: 'active' }
    ])
    expect(commitment.statusHistory()).toMatchObject([
      { from: null, to: 'active' },
      { from: 'active', to: 'done' }
    ])
  })

  it('validates parents, dates, required text, cadence, frequency, and enums', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    expect(() =>
      database!.domain.threads.create({
        focusId: 999,
        title: 'Missing focus',
        reviewFrequencyDays: 7
      })
    ).toThrow(ModelNotFoundError)
    expect(() =>
      database!.domain.threads.create({
        focusId: focus.id,
        title: 'Bad frequency',
        reviewFrequencyDays: 0
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.commitments.create({
        parent: { type: 'focus', id: focus.id },
        type: 'ongoing',
        title: 'Bad cadence',
        cadenceDays: -1
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.commitments.create({
        parent: { type: 'focus', id: focus.id },
        type: 'action',
        title: 'Bad date',
        dueDate: '2026-02-30'
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.updates.create({
        parent: { type: 'focus', id: focus.id },
        date: 'tomorrow',
        observation: 'Invalid date'
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.updates.create({
        parent: { type: 'commitment', id: 999 },
        observation: 'Missing parent'
      })
    ).toThrow(ModelNotFoundError)
    expect(() =>
      database!.domain.updates.create({
        parent: { type: 'focus', id: focus.id },
        observation: 'Bad state',
        state: 'blue' as never
      })
    ).toThrow(ModelValidationError)
  })

  it('persists a state-only update and materializes it on its Commitment', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Keep sponsors aligned'
    })

    const update = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-08-07',
      state: 'red'
    })

    expect(update.toSnapshot()).toMatchObject({ observation: '', state: 'red' })
    expect(database!.domain.commitments.listForFocus(focus.id, '2026-08-07')[0]).toMatchObject({
      id: commitment.id,
      state: 'red',
      lastUpdateDate: '2026-08-07'
    })
  })

  it('enforces exactly one parent at the SQLite layer', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const raw = new DatabaseSync(databasePath)
    raw.exec('PRAGMA foreign_keys = ON')

    expect(() =>
      raw
        .prepare(
          `INSERT INTO commitments (
             focus_id, thread_id, commitment_type, title, status, created_at, updated_at
           ) VALUES (?, ?, 'action', 'Invalid', 'active', ?, ?)`
        )
        .run(focus.id, thread.id, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    ).toThrow()
    expect(() =>
      raw
        .prepare(
          `INSERT INTO updates (
             focus_id, thread_id, recorded_on, observation, state, created_at
           ) VALUES (?, ?, '2026-01-01', 'Invalid', 'none', ?)`
        )
        .run(focus.id, thread.id, '2026-01-01T00:00:00.000Z')
    ).toThrow()
    raw.close()
  })

  it('cascades child records and histories only when their owning parent is deleted', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const threadCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'action',
      title: 'Improve ticket quality'
    })
    const focusCommitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Stakeholder alignment'
    })
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Thread update'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: threadCommitment.id },
      observation: 'Commitment update'
    })

    thread.delete()
    expect(database!.domain.commitments.find(threadCommitment.id)).toBeNull()
    expect(database!.domain.commitments.find(focusCommitment.id)).not.toBeNull()

    focus.delete()
    expect(database!.domain.commitments.find(focusCommitment.id)).toBeNull()
    const raw = new DatabaseSync(databasePath)
    for (const table of [
      'threads',
      'commitments',
      'updates',
      'thread_status_transitions',
      'commitment_status_transitions'
    ]) {
      const row = raw.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }
      expect(Number(row.count)).toBe(0)
    }
    raw.close()
  })

  it('retains the complete derived model after reopening SQLite', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Improve ticket quality',
      cadenceDays: 7
    })
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-01',
      observation: 'Sprint review is green',
      state: 'green'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-01',
      observation: 'Ticket quality improved',
      state: 'green'
    })
    const threadId = thread.id
    const commitmentId = commitment.id
    database!.close()

    database = new AppDatabase(databasePath)
    expect(database.domain.threads.materialize(threadId, '2026-01-02')).toMatchObject({
      health: 'green',
      lastReviewDate: '2026-01-01'
    })
    expect(database.domain.commitments.materialize(commitmentId, '2026-01-02')).toMatchObject({
      state: 'green',
      lastUpdateDate: '2026-01-01',
      nextUpdateDate: '2026-01-08'
    })
    expect(database.domain.updates.listForCommitment(commitmentId)).toHaveLength(1)
  })
})
