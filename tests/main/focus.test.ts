import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { ModelValidationError } from '../../src/main/data/model'

describe('Focus models', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-focus-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates a top-level generic focus with active status by default', () => {
    const focus = database!.domain.focuses.create({ title: 'Ship the first version' })

    expect(focus.toSnapshot()).toMatchObject({
      kind: 'generic',
      title: 'Ship the first version',
      description: null,
      goal: '',
      status: 'active',
      lastReviewDate: null,
      needsReview: true,
      statusChangedAt: expect.any(String)
    })
    expect(focus.statusHistory()).toMatchObject([{ from: null, to: 'active' }])
  })

  it('allows duplicate titles and preserves insertion order', () => {
    const first = database!.domain.focuses.create({ title: 'Same title' })
    const second = database!.domain.focuses.create({ title: 'Same title' })

    expect(second.id).not.toBe(first.id)
    expect(database!.domain.focuses.list().map(({ title }) => title)).toEqual([
      'Same title',
      'Same title'
    ])
  })

  it('edits details and records every directional status transition once', () => {
    const focus = database!.domain.focuses.create({ title: 'Original' })

    focus.update({
      title: 'Updated',
      description: 'Notes',
      goal: 'Deliver predictable value',
      status: 'paused'
    })
    focus.setStatus('active').setStatus('done').setStatus('done')

    expect(focus.toSnapshot()).toMatchObject({
      title: 'Updated',
      description: 'Notes',
      goal: 'Deliver predictable value',
      status: 'done'
    })
    expect(focus.statusHistory()).toMatchObject([
      { from: null, to: 'active' },
      { from: 'active', to: 'paused' },
      { from: 'paused', to: 'active' },
      { from: 'active', to: 'done' }
    ])
  })

  it('normalizes optional notes and validates titles and enum values', () => {
    const focus = database!.domain.focuses.create({
      title: '  Valid  ',
      description: '   ',
      goal: '  Make progress  '
    })

    expect(focus.toSnapshot()).toMatchObject({
      title: 'Valid',
      description: null,
      goal: 'Make progress'
    })
    expect(() => database!.domain.focuses.create({ title: '   ' })).toThrow(ModelValidationError)
    expect(() => database!.domain.focuses.create({ title: 'Invalid', kind: 'other' as never })).toThrow(
      ModelValidationError
    )
    expect(() =>
      database!.domain.focuses.create({ title: 'Invalid', needsReview: 'yes' as never })
    ).toThrow(ModelValidationError)
    expect(() => focus.setStatus('unknown' as never)).toThrow(ModelValidationError)
  })

  it('keeps cancelled and done focuses in storage for renderer-side filtering', () => {
    database!.domain.focuses.create({ title: 'Active' })
    database!.domain.focuses.create({ title: 'Paused', status: 'paused' })
    database!.domain.focuses.create({ title: 'Cancelled', status: 'cancelled' })
    database!.domain.focuses.create({ title: 'Done', status: 'done' })

    expect(database!.domain.focuses.list().map(({ status }) => status)).toEqual([
      'active',
      'paused',
      'cancelled',
      'done'
    ])
  })

  it('protects status history from rewrites but cascades it with focus deletion', () => {
    const focus = database!.domain.focuses.create({ title: 'Temporary' })
    focus.setStatus('paused')
    const raw = new DatabaseSync(databasePath)

    expect(() =>
      raw
        .prepare("UPDATE focus_status_transitions SET to_status = 'done' WHERE focus_id = ?")
        .run(focus.id)
    ).toThrow(/immutable/)
    expect(() =>
      raw.prepare('DELETE FROM focus_status_transitions WHERE focus_id = ?').run(focus.id)
    ).toThrow(/immutable/)

    expect(focus.delete()).toBe(true)
    const row = raw
      .prepare('SELECT count(*) AS count FROM focus_status_transitions WHERE focus_id = ?')
      .get(focus.id) as { count: number }
    raw.close()
    expect(Number(row.count)).toBe(0)
  })

  it('retains details and status history after reopening', () => {
    const focus = database!.domain.focuses.create({
      title: 'Persistent',
      description: 'Stored in SQLite',
      goal: 'Retain the goal too'
    })
    focus.setStatus('paused').update({ needsReview: false })
    const id = focus.id
    database!.close()

    database = new AppDatabase(databasePath)
    const reopened = database.domain.focuses.requireModel(id)

    expect(reopened.toSnapshot()).toMatchObject({
      title: 'Persistent',
      description: 'Stored in SQLite',
      goal: 'Retain the goal too',
      status: 'paused',
      needsReview: false
    })
    expect(reopened.statusHistory()).toHaveLength(2)
  })

  it('derives last review from only the latest effective direct Focus update', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Align sponsors'
    })

    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-04',
      observation: 'Thread reviewed'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-05',
      observation: 'Commitment reviewed'
    })
    expect(focus.snapshot('2026-01-05').lastReviewDate).toBeNull()

    database!.domain.updates.create({
      parent: { type: 'focus', id: focus.id },
      date: '2026-01-03',
      observation: 'Focus reviewed'
    })
    database!.domain.updates.create({
      parent: { type: 'focus', id: focus.id },
      date: '2026-01-10',
      observation: 'Future review'
    })

    expect(focus.snapshot('2026-01-09').lastReviewDate).toBe('2026-01-03')
    expect(focus.snapshot('2026-01-10').lastReviewDate).toBe('2026-01-10')
  })
})
