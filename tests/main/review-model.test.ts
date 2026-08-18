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

  it('includes initial reviews but suppresses recent evidence until scheduled work is due', () => {
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
    const oversight = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Stakeholder oversight',
      reviewFrequencyDays: 30,
      needsReview: false
    }, new Date('2026-01-01T12:00:00.000Z'))
    const overall = database!.domain.commitments.create({
      parent: { type: 'thread', id: oversight.id },
      type: 'tracking',
      title: 'Keep sponsors aligned',
      cadenceDays: 7
    }, new Date('2026-01-01T12:00:00.000Z'))
    const threaded = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality',
      cadenceDays: 7
    }, new Date('2026-01-01T12:00:00.000Z'))
    const unscheduled = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
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
      `thread:${thread.id}`,
      `commitment:${unscheduled.id}`,
      `commitment:${overall.id}`
    ])
    expect(overview.items.find(({ key }) => key === `thread:${thread.id}`)).toMatchObject({
      kind: 'thread',
      focus: { id: focus.id },
      thread: { id: thread.id, reviewDue: false },
      due: false,
      cell: null,
      commitments: expect.arrayContaining([expect.objectContaining({ id: threaded.id })])
    })
    expect(overview.items.find(({ key }) => key === `commitment:${threaded.id}`)).toBeUndefined()
    expect(overview.items.find(({ key }) => key === `commitment:${unscheduled.id}`))
      .toMatchObject({ nextReviewDate: expect.any(String), due: false })
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
      type: 'tracking',
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
    const after = database!.domain.reviews.getOverview('2026-01-08')
    expect(after.items.filter(({ kind }) => kind === 'thread').map(({ cell }) =>
      cell?.subject.name)).toEqual(['Jamie'])
    expect(after.items.filter(({ kind }) => kind === 'commitment').map(({ cell }) =>
      cell?.subject.name)).toEqual(['Jamie'])
    expect(after.items.filter(({ kind }) => kind === 'thread').map(({ cell, due }) => ({
      subject: cell?.subject.name,
      due
    }))).toEqual([
      { subject: 'Jamie', due: true }
    ])
    expect(after.items.filter(({ kind }) => kind === 'commitment').map(({ cell, due }) => ({
      subject: cell?.subject.name,
      due
    }))).toEqual([
      { subject: 'Jamie', due: true }
    ])

    const jamieCell = { scopeId: reports.id, subjectId: jamie.id }
    expect(() => thread.pokeReview(new Date('2026-01-08T12:00:00.000Z'), {
      scopeId: reports.id,
      subjectId: 999
    })).toThrow(/currently effective/)
    expect(() => commitment.pokeReview(new Date('2026-01-08T12:00:00.000Z'), {
      scopeId: reports.id,
      subjectId: 999
    })).toThrow(/currently effective/)
    thread.pokeReview(new Date('2026-01-08T12:00:00.000Z'), jamieCell)
    commitment.pokeReview(new Date('2026-01-08T12:00:00.000Z'), jamieCell)
    const reviewed = database!.domain.reviews.getOverview('2026-01-08')
    expect(reviewed.items.filter(({ kind }) => kind === 'thread')).toEqual([])
    expect(reviewed.items.filter(({ kind }) => kind === 'commitment')).toEqual([])

    expect(thread.scopeMatrix('2026-01-08')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subjectId: jamie.id,
        lastReviewDate: '2026-01-08',
        reviewDue: false
      })
    ]))
    expect(commitment.scopeMatrix('2026-01-08')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subjectId: jamie.id,
        lastReviewDate: '2026-01-08',
        lastUpdateDate: null,
        needsUpdate: true
      })
    ]))
    expect(database!.domain.reviews.getOverview('2026-01-09').items
      .filter(({ kind }) => kind === 'commitment').map(({ cell }) => cell?.subject.name))
      .toEqual([])
  })

  it('uses a Commitment review schedule independently of its parent and honors exclusion', () => {
    const focus = database!.domain.focuses.create({
      title: 'Independent delivery',
      needsReview: false
    })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Long-range planning',
      reviewFrequencyDays: 30,
      needsReview: false
    }, new Date('2026-01-01T12:00:00.000Z'))
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Watch the near-term risk',
      reviewFrequencyDays: 3
    }, new Date('2026-01-01T12:00:00.000Z'))

    commitment.pokeReview(new Date('2026-01-01T12:00:00.000Z'))
    expect(database!.domain.reviews.getOverview('2026-01-03').items).toEqual([])
    expect(database!.domain.reviews.getOverview('2026-01-04').items.map(({ key }) => key))
      .toEqual([`commitment:${commitment.id}`])

    commitment.update({ needsReview: false })
    expect(database!.domain.reviews.getOverview('2026-01-04').items).toEqual([])
  })

  it('does not queue a Focus that was explicitly reviewed today', () => {
    const focus = database!.domain.focuses.create({ title: 'Current board' })
    focus.pokeReview(new Date('2026-01-10T12:00:00.000Z'))

    expect(database!.domain.reviews.getOverview('2026-01-10').items
      .filter(({ kind }) => kind === 'focus')).toEqual([])
    expect(database!.domain.reviews.getOverview('2026-01-11').items
      .filter(({ kind }) => kind === 'focus').map(({ key }) => key))
      .toEqual([`focus:${focus.id}`])
  })

  it('omits inactive ancestry and reacts to deletion without retained queue records', () => {
    const pausedFocus = database!.domain.focuses.create({
      title: 'Paused program',
      status: 'paused'
    })
    const pausedThread = database!.domain.threads.create({
      focusId: pausedFocus.id,
      title: 'Paused delivery',
      reviewFrequencyDays: 7
    })
    const hiddenCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: pausedThread.id },
      type: 'tracking',
      title: 'Hidden cadence',
      cadenceDays: 1
    }, new Date('2026-01-01T12:00:00.000Z'))
    const activeFocus = database!.domain.focuses.create({
      title: 'Active program',
      needsReview: false
    })
    const activeThread = database!.domain.threads.create({
      focusId: activeFocus.id,
      title: 'Active delivery',
      reviewFrequencyDays: 7,
      needsReview: false
    })
    const visibleCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: activeThread.id },
      type: 'tracking',
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
