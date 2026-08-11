import { describe, expect, it } from 'vitest'
import type { TodoSnapshot } from '../../src/shared/contracts'
import { todoListProjection } from '../../src/renderer/src/features/todos/todo-presenters'

function todo(overrides: Partial<TodoSnapshot> = {}): TodoSnapshot {
  return {
    id: 1,
    name: 'Review the plan',
    parent: { type: 'focus', id: 1 },
    subject: null,
    sharedAcrossSubjects: false,
    subjectCompletions: [],
    dueDate: null,
    done: false,
    completedAt: null,
    sort: [],
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  }
}

describe('todoListProjection', () => {
  it('marks only incomplete past-due work overdue', () => {
    const projection = todoListProjection([
      todo({ dueDate: '2026-08-08' }),
      todo({ id: 2, dueDate: '2026-08-10' }),
      todo({ id: 3, dueDate: '2026-08-01', done: true })
    ], {
      today: '2026-08-09'
    })

    expect(projection.items.map(({ overdue }) => overdue)).toEqual([true, false, false])
    expect(projection.orphanedItems).toEqual([])
  })

  it('keeps current canonical Subjects in the main list and splits removed cells as orphaned', () => {
    const platform = {
      id: 5,
      kind: 'generic' as const,
      name: 'Platform Team',
      description: null,
      externalKey: null,
      sensitive: false,
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z'
    }
    const customer = { ...platform, id: 6, name: 'Customer Operations' }
    const projection = todoListProjection([
      todo({
        id: 4,
        parent: {
          type: 'thread-scope',
          id: 8,
          scope: { scopeId: 3, subjectId: 5 }
        },
        subject: platform
      }),
      todo({
        id: 5,
        parent: {
          type: 'thread-scope',
          id: 8,
          scope: { scopeId: 3, subjectId: 6 }
        },
        subject: customer
      }),
      todo({ id: 6, parent: { type: 'thread', id: 8 } })
    ], {
      today: '2026-08-09',
      currentCells: [{ scopeId: 9, subjectId: 5 }]
    })

    expect(projection.items.map(({ id, contextLabel }) => ({ id, contextLabel }))).toEqual([
      { id: '4', contextLabel: 'Platform Team' }
    ])
    expect(projection.orphanedItems.map(({ id, contextLabel }) => ({ id, contextLabel })))
      .toEqual([
        { id: '5', contextLabel: 'Customer Operations · Orphaned' },
        { id: '6', contextLabel: 'Orphaned' }
      ])
  })

  it('keeps unscoped fallback Todos current when no Subjects remain', () => {
    const projection = todoListProjection([
      todo({ id: 7, parent: { type: 'thread', id: 8 } }),
      todo({
        id: 8,
        parent: {
          type: 'thread-scope',
          id: 8,
          scope: { scopeId: 3, subjectId: 5 }
        }
      })
    ], {
      today: '2026-08-09',
      currentCells: []
    })

    expect(projection.items.map(({ id }) => id)).toEqual(['7'])
    expect(projection.orphanedItems.map(({ id }) => id)).toEqual(['8'])
  })

  it('projects a shared parent in aggregate and exact Subject views', () => {
    const customer = {
      id: 6,
      kind: 'generic' as const,
      name: 'Customer Operations',
      description: null,
      externalKey: null,
      sensitive: false,
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z'
    }
    const platform = { ...customer, id: 7, name: 'Platform Team' }
    const shared = todo({
      parent: { type: 'thread', id: 8 },
      sharedAcrossSubjects: true,
      subjectCompletions: [
        {
          subject: customer,
          done: true,
          completedAt: '2026-08-08T12:00:00.000Z',
          createdAt: '2026-08-01T12:00:00.000Z',
          updatedAt: '2026-08-08T12:00:00.000Z'
        },
        {
          subject: platform,
          done: false,
          completedAt: null,
          createdAt: '2026-08-01T12:00:00.000Z',
          updatedAt: '2026-08-01T12:00:00.000Z'
        }
      ]
    })

    const aggregate = todoListProjection([shared], {
      today: '2026-08-09',
      currentCells: [
        { scopeId: 9, subjectId: customer.id },
        { scopeId: 9, subjectId: platform.id }
      ]
    })
    expect(aggregate.items[0]).toMatchObject({
      contextLabel: 'All subjects',
      canToggleDone: false,
      subjectCompletions: [
        { subjectId: '6', done: true },
        { subjectId: '7', done: false }
      ]
    })
    expect(aggregate.orphanedItems).toEqual([])

    const exact = todoListProjection([shared], {
      today: '2026-08-09',
      selectedSubjectId: platform.id
    })
    expect(exact.items[0]).toMatchObject({
      done: false,
      contextLabel: 'Shared',
      canEdit: false,
      canDelete: false,
      completionSubjectId: '7'
    })
  })
})
