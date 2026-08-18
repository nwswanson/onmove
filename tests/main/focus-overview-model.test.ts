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
        { id: completed.id, title: 'Discovery', status: 'done', sensitive: true },
        { id: sprint.id, title: 'Sprint execution', status: 'active', sensitive: false }
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
          source: { type: 'thread', id: sprint.id, title: 'Sprint execution' }
        }
      ]
    })
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
})
