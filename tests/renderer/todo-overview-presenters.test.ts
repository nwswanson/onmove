import { describe, expect, it } from 'vitest'
import type { TodoOverviewItemSnapshot } from '../../src/shared/contracts'
import {
  sortTodoOverviewRows,
  todoOverviewDestination,
  todoOverviewRows
} from '../../src/renderer/src/features/todos/todo-overview-presenters'

function todo(overrides: Partial<TodoOverviewItemSnapshot> = {}): TodoOverviewItemSnapshot {
  return {
    id: 1,
    name: 'Review rollout',
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
    focus: { id: 1, title: 'Project Atlas', sensitive: false },
    thread: null,
    commitment: null,
    ...overrides
  }
}

describe('Todo overview presenters', () => {
  it('resolves hierarchy labels, overdue state, and cascading sensitive visibility', () => {
    const rows = todoOverviewRows([
      todo({ dueDate: '2026-08-08' }),
      todo({
        id: 2,
        name: 'Commitment work',
        parent: { type: 'commitment', id: 9 },
        thread: { id: 4, title: 'Sprint execution', sensitive: false },
        commitment: { id: 9, title: 'Improve ticket quality', sensitive: false },
        subject: {
          id: 12,
          kind: 'generic',
          name: 'Customer Operations',
          description: null,
          externalKey: null,
          sensitive: false,
          createdAt: '2026-08-01T12:00:00.000Z',
          updatedAt: '2026-08-01T12:00:00.000Z'
        }
      }),
      todo({
        id: 3,
        name: 'Hidden descendant',
        focus: { id: 2, title: 'Private project', sensitive: true }
      })
    ], { today: '2026-08-10', hideSensitiveContent: true })

    expect(rows).toMatchObject([
      { id: '1', context: 'Overall', overdue: true },
      {
        id: '2',
        context: 'Sprint execution › Improve ticket quality › Customer Operations',
        overdue: false
      }
    ])
  })

  it('describes a complete Focus workspace destination without exposing it to the table', () => {
    const scopedTodo = todo({
      parent: { type: 'commitment-scope', id: 9, scope: { scopeId: 5, subjectId: 12 } },
      thread: { id: 4, title: 'Sprint execution', sensitive: false },
      commitment: { id: 9, title: 'Improve ticket quality', sensitive: false },
      subject: {
        id: 12,
        kind: 'generic',
        name: 'Customer Operations',
        description: null,
        externalKey: null,
        sensitive: false,
        createdAt: '2026-08-01T12:00:00.000Z',
        updatedAt: '2026-08-01T12:00:00.000Z'
      }
    })

    expect(todoOverviewDestination(scopedTodo)).toEqual({
      focusId: 1,
      threadId: 4,
      commitmentId: 9,
      subjectId: 12
    })
  })

  it('projects one shared parent with receiver-owned current Subject completion rows', () => {
    const rows = todoOverviewRows([todo({
      parent: { type: 'thread', id: 4 },
      thread: { id: 4, title: 'Sprint execution', sensitive: false },
      sharedAcrossSubjects: true,
      subjectCompletions: [
        {
          subject: {
            id: 12,
            kind: 'generic',
            name: 'Customer Operations',
            description: null,
            externalKey: null,
            sensitive: false,
            createdAt: '2026-08-01T12:00:00.000Z',
            updatedAt: '2026-08-01T12:00:00.000Z'
          },
          done: true,
          completedAt: '2026-08-09T12:00:00.000Z',
          createdAt: '2026-08-01T12:00:00.000Z',
          updatedAt: '2026-08-09T12:00:00.000Z'
        },
        {
          subject: {
            id: 13,
            kind: 'generic',
            name: 'Sensitive Team',
            description: null,
            externalKey: null,
            sensitive: true,
            createdAt: '2026-08-01T12:00:00.000Z',
            updatedAt: '2026-08-01T12:00:00.000Z'
          },
          done: false,
          completedAt: null,
          createdAt: '2026-08-01T12:00:00.000Z',
          updatedAt: '2026-08-01T12:00:00.000Z'
        }
      ]
    })], { today: '2026-08-10', hideSensitiveContent: true })

    expect(rows).toEqual([expect.objectContaining({
      id: '1',
      reference: { value: 'TD.1', label: 'Todo ID' },
      sharedAcrossSubjects: true,
      subjectCompletions: [{
        subjectId: '12',
        label: 'Customer Operations',
        reference: { value: 'S.12', label: 'Subject ID' },
        done: true
      }]
    })])
  })

  it('sorts projects and due dates without moving undated work ahead of dated work', () => {
    const rows = todoOverviewRows([
      todo({ id: 1, name: 'Undated', focus: { id: 2, title: 'Zulu', sensitive: false } }),
      todo({
        id: 2,
        name: 'Later',
        dueDate: '2026-08-12',
        focus: { id: 3, title: 'Alpha', sensitive: false }
      }),
      todo({
        id: 3,
        name: 'Sooner',
        dueDate: '2026-08-11',
        focus: { id: 4, title: 'Beta', sensitive: false }
      })
    ], { today: '2026-08-10', hideSensitiveContent: false })

    expect(sortTodoOverviewRows(rows, {
      key: 'project', direction: 'ascending'
    }).map(({ id }) => id)).toEqual(['2', '3', '1'])
    expect(sortTodoOverviewRows(rows, {
      key: 'dueDate', direction: 'ascending'
    }).map(({ id }) => id)).toEqual(['3', '2', '1'])
  })
})
