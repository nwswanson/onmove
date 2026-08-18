import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('Focus Overview timeline model', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-focus-overview-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('assigns direct and nested evidence to every active or closed Thread rail', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const sprint = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const completed = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Discovery',
      reviewFrequencyDays: 14,
      status: 'done',
      sensitive: true
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: sprint.id },
      type: 'tracking',
      title: 'Improve ticket quality',
      sensitive: true
    })
    const direct = database!.domain.updates.create({
      parent: { type: 'thread', id: sprint.id },
      date: '2026-08-17',
      observation: 'Sprint plan stabilized.',
      state: 'green'
    })
    const nested = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-08-18',
      observation: 'Examples still need work.',
      state: 'yellow'
    })

    expect(database!.domain.focusOverview.timeline(focus.id)).toEqual({
      focusId: focus.id,
      threads: [
        { id: completed.id, title: 'Discovery', status: 'done', sensitive: true, subjects: [] },
        {
          id: sprint.id,
          title: 'Sprint execution',
          status: 'active',
          sensitive: false,
          subjects: []
        }
      ],
      updates: [
        {
          id: nested.id,
          threadId: sprint.id,
          date: '2026-08-18',
          observation: 'Examples still need work.',
          state: 'yellow',
          sensitive: false,
          effectiveSensitive: true,
          scope: null,
          source: { type: 'commitment', id: commitment.id, title: 'Improve ticket quality' }
        },
        {
          id: direct.id,
          threadId: sprint.id,
          date: '2026-08-17',
          observation: 'Sprint plan stabilized.',
          state: 'green',
          sensitive: false,
          effectiveSensitive: false,
          scope: null,
          source: { type: 'thread', id: sprint.id, title: 'Sprint execution' }
        }
      ]
    })
  })

  it('projects current Subjects and preserves each Update exact Subject cell', () => {
    const now = new Date('2026-08-01T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    database!.domain.focusScopes.addSubject(focus.id, { name: 'North region' }, now)
    const scope = database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'South region' },
      now
    )
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Regional rollout',
      reviewFrequencyDays: 7
    }, now)
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Confirm readiness'
    }, now)
    const north = scope.subjects.find(({ name }) => name === 'North region')!
    const south = scope.subjects.find(({ name }) => name === 'South region')!
    const northUpdate = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-18',
      observation: 'North is ready.',
      state: 'green',
      scope: { scopeId: scope.scopeId!, subjectId: north.id }
    }, now)
    const southUpdate = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-08-18',
      observation: 'South remains blocked.',
      state: 'red',
      scope: { scopeId: scope.scopeId!, subjectId: south.id }
    }, now)

    const timeline = database!.domain.focusOverview.timeline(focus.id)

    expect(timeline.threads).toEqual([expect.objectContaining({
      id: thread.id,
      subjects: [
        { id: north.id, name: 'North region' },
        { id: south.id, name: 'South region' }
      ]
    })])
    expect(timeline.updates).toEqual([
      expect.objectContaining({
        id: southUpdate.id,
        scope: {
          scopeId: scope.scopeId,
          subject: { id: south.id, name: 'South region' }
        }
      }),
      expect.objectContaining({
        id: northUpdate.id,
        scope: {
          scopeId: scope.scopeId,
          subject: { id: north.id, name: 'North region' }
        }
      })
    ])
  })

  it('validates the Focus boundary and removes a deleted Thread rail atomically', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Evidence'
    })

    expect(() => database!.domain.focusOverview.timeline(0)).toThrow('positive integer')
    expect(() => database!.domain.focusOverview.timeline(999)).toThrow('does not exist')
    expect(database!.domain.threads.delete(thread.id)).toBe(true)
    expect(database!.domain.focusOverview.timeline(focus.id)).toEqual({
      focusId: focus.id,
      threads: [],
      updates: []
    })
  })

  it('never projects Updates from closed or deleted Commitments', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const active = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Active evidence'
    })
    const done = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Completed evidence'
    })
    const cancelled = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Cancelled evidence'
    })
    const deleted = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Deleted evidence'
    })
    const visibleUpdate = database!.domain.updates.create({
      parent: { type: 'commitment', id: active.id },
      observation: 'Still current'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: done.id },
      observation: 'Already completed'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: cancelled.id },
      observation: 'No longer pursued'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: deleted.id },
      observation: 'Rescued into Update Archive'
    })
    database!.domain.commitments.update(done.id, { status: 'done' })
    database!.domain.commitments.update(cancelled.id, { status: 'cancelled' })
    expect(database!.domain.commitments.delete(deleted.id)).toBe(true)

    expect(database!.domain.focusOverview.timeline(focus.id).updates).toEqual([
      expect.objectContaining({
        id: visibleUpdate.id,
        source: { type: 'commitment', id: active.id, title: 'Active evidence' }
      })
    ])
  })
})
