import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('Navigation badge model', () => {
  let directory: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-navigation-model-test-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('counts actionable date and review windows while partitioning sensitive hierarchies', () => {
    const reviewed = database!.domain.focuses.create({
      title: 'Project Atlas',
      dueDate: '2026-08-12'
    })
    const sensitive = database!.domain.focuses.create({
      title: 'Sensitive launch',
      dueDate: '2026-08-13',
      sensitive: true
    })
    database!.domain.focuses.create({
      title: 'Horizon edge',
      dueDate: '2026-08-19',
      needsReview: false
    })
    database!.domain.focuses.create({
      title: 'Outside horizon',
      dueDate: '2026-08-20',
      needsReview: false
    })
    database!.domain.focuses.create({
      title: 'Already closed',
      dueDate: '2026-08-01',
      status: 'done',
      needsReview: false
    })
    database!.domain.threads.create({
      focusId: reviewed.id,
      title: 'Paused but dated',
      dueDate: '2026-08-10',
      status: 'paused',
      needsReview: false,
      reviewFrequencyDays: 7
    })

    database!.domain.todos.create({
      parent: { type: 'focus', id: reviewed.id },
      name: 'Overdue Todo',
      dueDate: '2026-08-11'
    })
    database!.domain.todos.create({
      parent: { type: 'focus', id: reviewed.id },
      name: 'Due today',
      dueDate: '2026-08-12'
    })
    database!.domain.todos.create({
      parent: { type: 'focus', id: reviewed.id },
      name: 'Future Todo',
      dueDate: '2026-08-13'
    })
    database!.domain.todos.create({
      parent: { type: 'focus', id: reviewed.id },
      name: 'Completed overdue Todo',
      dueDate: '2026-08-01',
      done: true
    })
    database!.domain.todos.create({
      parent: { type: 'focus', id: sensitive.id },
      name: 'Sensitive overdue Todo',
      dueDate: '2026-08-01'
    })

    expect(database!.domain.navigation.getBadgeOverview(
      new Date('2026-08-12T12:00:00.000Z')
    )).toEqual({
      asOf: '2026-08-12',
      dueThrough: '2026-08-19',
      todos: { total: 3, nonSensitive: 2 },
      review: { total: 2, nonSensitive: 1 },
      due: { total: 4, nonSensitive: 3 }
    })

    reviewed.pokeReview(new Date('2026-08-12T12:00:00.000Z'))
    expect(database!.domain.navigation.getBadgeOverview(
      new Date('2026-08-12T12:00:00.000Z')
    ).review).toEqual({ total: 1, nonSensitive: 0 })
  })
})
