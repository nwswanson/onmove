import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('Review model', () => {
  let directory: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-review-model-test-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('returns every active aggregate that participates in review before it is due', () => {
    const focus = database!.domain.focuses.create({
      title: 'Project Atlas',
      needsReview: false
    })
    const thread = database!.domain.threads.create(
      {
        focusId: focus.id,
        title: 'Sprint execution',
        reviewFrequencyDays: 7
      },
      new Date('2026-01-01T12:00:00.000Z')
    )
    const overall = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Keep sponsors aligned',
      cadenceDays: 7
    }, new Date('2026-01-01T12:00:00.000Z'))
    const threaded = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Improve ticket quality',
      cadenceDays: 7
    }, new Date('2026-01-01T12:00:00.000Z'))
    const unscheduled = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Unscheduled expectation'
    })

    database!.domain.updates.create({
      parent: { type: 'commitment', id: threaded.id },
      date: '2026-01-02',
      observation: 'Tickets still need examples',
      state: 'yellow'
    })

    const overview = database!.domain.reviews.getOverview('2026-01-03')

    expect(overview.asOf).toBe('2026-01-03')
    expect(overview.items.map(({ key }) => key)).toEqual([
      `commitment:${overall.id}`,
      `thread:${thread.id}`,
      `commitment:${threaded.id}`,
      `commitment:${unscheduled.id}`
    ])
    expect(overview.items.find(({ key }) => key === `thread:${thread.id}`)).toMatchObject({
      kind: 'thread',
      focus: { id: focus.id },
      thread: { id: thread.id, reviewDue: false },
      due: false,
      cell: null,
      commitments: expect.arrayContaining([expect.objectContaining({ id: threaded.id })])
    })
    expect(overview.items.find(({ key }) => key === `commitment:${threaded.id}`)).toMatchObject({
      kind: 'commitment',
      state: 'yellow',
      lastReviewDate: '2026-01-02',
      nextReviewDate: '2026-01-09',
      due: false,
      updates: [{ observation: 'Tickets still need examples' }]
    })
    expect(overview.items.find(({ key }) => key === `commitment:${unscheduled.id}`))
      .toMatchObject({ nextReviewDate: null, due: false })
  })

  it('keeps bounded Thread and Commitment review obligations independent per Subject', () => {
    const focus = database!.domain.focuses.create({ title: 'Team effectiveness' })
    const alex = database!.domain.subjects.create({ kind: 'person', name: 'Alex' })
    const jamie = database!.domain.subjects.create({ kind: 'person', name: 'Jamie' })
    const reports = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Direct reports',
      dimension: 'people'
    })
    for (const person of [alex, jamie]) {
      database!.domain.scopeMemberships.create({
        scopeId: reports.id,
        subjectId: person.id,
        effectiveFrom: '2026-01-01'
      })
    }
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Career direction',
      reviewFrequencyDays: 7,
      scope: { mode: 'explicit', scopeId: reports.id }
    }, new Date('2026-01-01T12:00:00.000Z'))
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Hold a substantive career conversation',
      cadenceDays: 7
    }, new Date('2026-01-01T12:00:00.000Z'))

    const before = database!.domain.reviews.getOverview('2026-01-02')
    expect(before.items.filter(({ kind }) => kind === 'thread').map(({ cell }) =>
      cell?.subject.name)).toEqual(['Alex', 'Jamie'])
    expect(before.items.filter(({ kind }) => kind === 'commitment').map(({ cell }) =>
      cell?.subject.name)).toEqual(['Alex', 'Jamie'])

    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-08',
      state: 'green',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-08',
      state: 'green',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })
    thread.pokeReview(new Date('2026-01-08T12:00:00.000Z'))

    const after = database!.domain.reviews.getOverview('2026-01-08')
    expect(after.items.filter(({ kind }) => kind === 'thread').map(({ cell }) =>
      cell?.subject.name)).toEqual(['Alex', 'Jamie'])
    expect(after.items.filter(({ kind }) => kind === 'commitment').map(({ cell }) =>
      cell?.subject.name)).toEqual(['Alex', 'Jamie'])
    expect(after.items.filter(({ kind }) => kind === 'thread').map(({ cell, due }) => ({
      subject: cell?.subject.name,
      due
    }))).toEqual([
      { subject: 'Alex', due: false },
      { subject: 'Jamie', due: true }
    ])
    expect(after.items.filter(({ kind }) => kind === 'commitment').map(({ cell, due }) => ({
      subject: cell?.subject.name,
      due
    }))).toEqual([
      { subject: 'Alex', due: false },
      { subject: 'Jamie', due: true }
    ])
  })

  it('omits inactive ancestry and reacts to deletion without retained queue records', () => {
    const pausedFocus = database!.domain.focuses.create({
      title: 'Paused program',
      status: 'paused'
    })
    const hiddenCommitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: pausedFocus.id },
      type: 'ongoing',
      title: 'Hidden cadence',
      cadenceDays: 1
    }, new Date('2026-01-01T12:00:00.000Z'))
    const activeFocus = database!.domain.focuses.create({
      title: 'Active program',
      needsReview: false
    })
    const visibleCommitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: activeFocus.id },
      type: 'ongoing',
      title: 'Visible cadence',
      cadenceDays: 1
    }, new Date('2026-01-01T12:00:00.000Z'))

    expect(database!.domain.reviews.getOverview('2026-01-02').items.map(({ key }) => key))
      .toEqual([`commitment:${visibleCommitment.id}`])
    expect(database!.domain.commitments.delete(visibleCommitment.id)).toBe(true)
    expect(database!.domain.reviews.getOverview('2026-01-02').items).toEqual([])
    expect(database!.domain.commitments.find(hiddenCommitment.id)).not.toBeNull()
  })
})
