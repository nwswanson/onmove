import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { ModelValidationError } from '../../src/main/data/model'

describe('Due model', () => {
  let directory: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-due-model-test-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('returns only explicitly dated work in global date order with direct parents', () => {
    const atlas = database!.domain.focuses.create({
      title: 'Project Atlas',
      dueDate: '2026-09-10'
    })
    const undatedFocus = database!.domain.focuses.create({ title: 'Operations' })
    const sprint = database!.domain.threads.create({
      focusId: atlas.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7,
      dueDate: '2026-09-12'
    })
    database!.domain.threads.create({
      focusId: undatedFocus.id,
      title: 'Undated Thread',
      reviewFrequencyDays: 7
    })
    const overall = database!.domain.commitments.create({
      parent: { type: 'focus', id: atlas.id },
      type: 'action',
      title: 'Approve launch',
      dueDate: '2026-09-08'
    })
    const threaded = database!.domain.commitments.create({
      parent: { type: 'thread', id: sprint.id },
      type: 'action',
      title: 'Improve ticket quality',
      dueDate: '2026-09-15',
      status: 'done'
    })
    database!.domain.commitments.create({
      parent: { type: 'focus', id: atlas.id },
      type: 'ongoing',
      title: 'Undated expectation'
    })

    const overview = database!.domain.due.getOverview('2026-09-09')

    expect(overview.asOf).toBe('2026-09-09')
    expect(overview.items.map(({ key }) => key)).toEqual([
      `commitment:${overall.id}`,
      `focus:${atlas.id}`,
      `thread:${sprint.id}`,
      `commitment:${threaded.id}`
    ])
    expect(overview.items.find(({ key }) => key === `thread:${sprint.id}`)?.parent)
      .toEqual({ kind: 'focus', title: 'Project Atlas', dueDate: '2026-09-10' })
    expect(overview.items.find(({ key }) => key === `commitment:${threaded.id}`))
      .toMatchObject({
        commitment: { status: 'done' },
        parent: { kind: 'thread', title: 'Sprint execution', dueDate: '2026-09-12' }
      })
  })

  it('reacts to date removal and hierarchy deletion without retained aggregate rows', () => {
    const focus = database!.domain.focuses.create({
      title: 'Launch',
      dueDate: '2026-10-01'
    })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Readiness',
      reviewFrequencyDays: 7,
      dueDate: '2026-09-30'
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'action',
      title: 'Sign off',
      dueDate: '2026-09-29'
    })

    commitment.update({ dueDate: null })
    expect(database!.domain.due.getOverview('2026-09-01').items.map(({ key }) => key))
      .toEqual([`thread:${thread.id}`, `focus:${focus.id}`])

    expect(database!.domain.threads.delete(thread.id)).toBe(true)
    expect(database!.domain.due.getOverview('2026-09-01').items.map(({ key }) => key))
      .toEqual([`focus:${focus.id}`])
  })

  it('validates the materialization date', () => {
    expect(() => database!.domain.due.getOverview('2026-02-30'))
      .toThrow(ModelValidationError)
  })
})
