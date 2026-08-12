import { describe, expect, it } from 'vitest'
import type {
  CommitmentSnapshot,
  DueOverviewSnapshot,
  DueWorkItemSnapshot,
  FocusSnapshot,
  ThreadSnapshot
} from '../../src/shared/contracts'
import { dueWorkGroups } from '../../src/renderer/src/features/due/due-presenters'

function focus(overrides: Partial<FocusSnapshot> = {}): FocusSnapshot {
  return {
    id: 1,
    kind: 'generic',
    title: 'Project Atlas',
    description: null,
    goal: '',
    status: 'active',
    dueDate: '2026-08-10',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    lastReviewDate: null,
    needsReview: true,
    sensitive: false,
    notes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function thread(overrides: Partial<ThreadSnapshot> = {}): ThreadSnapshot {
  return {
    id: 2,
    focusId: 1,
    title: 'Sprint execution',
    health: 'none',
    status: 'paused',
    dueDate: '2026-08-09',
    reviewFrequencyDays: 7,
    lastReviewDate: null,
    nextReviewDate: '2026-08-17',
    needsReview: true,
    reviewDue: false,
    sensitive: false,
    notes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function commitment(overrides: Partial<CommitmentSnapshot> = {}): CommitmentSnapshot {
  return {
    id: 3,
    parent: { type: 'thread', id: 2 },
    type: 'action',
    title: 'Improve ticket quality',
    status: 'done',
    state: 'green',
    dueDate: '2026-08-12',
    cadenceDays: null,
    lastReviewDate: null,
    lastUpdateDate: null,
    nextUpdateDate: null,
    needsUpdate: false,
    sensitive: false,
    notes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function overview(items: DueWorkItemSnapshot[]): DueOverviewSnapshot {
  return { asOf: '2026-08-10', items }
}

it('groups globally ordered work by urgency while preserving hierarchy destinations', () => {
  const currentFocus = focus()
  const currentThread = thread()
  const currentCommitment = commitment()
  const groups = dueWorkGroups(overview([
    {
      key: 'commitment:3',
      kind: 'commitment',
      focus: currentFocus,
      thread: currentThread,
      commitment: currentCommitment,
      dueDate: '2026-08-12',
      parent: { kind: 'thread', title: currentThread.title, dueDate: currentThread.dueDate }
    },
    {
      key: 'focus:1',
      kind: 'focus',
      focus: currentFocus,
      thread: null,
      commitment: null,
      dueDate: '2026-08-10',
      parent: null
    },
    {
      key: 'thread:2',
      kind: 'thread',
      focus: currentFocus,
      thread: currentThread,
      commitment: null,
      dueDate: '2026-08-09',
      parent: { kind: 'focus', title: currentFocus.title, dueDate: currentFocus.dueDate }
    }
  ]), false)

  expect(groups.map(({ id, rows }) => ({ id, rows: rows.map(({ id: rowId }) => rowId) })))
    .toEqual([
      { id: 'overdue', rows: ['thread:2'] },
      { id: 'today', rows: ['focus:1'] },
      { id: 'upcoming', rows: ['commitment:3'] }
    ])
  expect(groups[2].rows[0]).toMatchObject({
    title: 'Improve ticket quality',
    locationLabel: 'Project Atlas › Sprint execution',
    status: 'done',
    parent: { label: 'Thread', dueDate: '2026-08-09' },
    destination: { focusId: 1, threadId: 2, commitmentId: 3, subjectId: null }
  })
})

describe('due-work visibility', () => {
  it('filters sensitive ancestry from the aggregate boundary', () => {
    const privateFocus = focus({ sensitive: true })
    const publicFocus = focus({ id: 4, title: 'Public launch', sensitive: false })
    const privateThread = thread({ id: 5, focusId: publicFocus.id, sensitive: true })
    const privateCommitment = commitment({
      id: 6,
      parent: { type: 'thread', id: privateThread.id },
      sensitive: false
    })
    const items: DueWorkItemSnapshot[] = [
      {
        key: 'focus:1',
        kind: 'focus',
        focus: privateFocus,
        thread: null,
        commitment: null,
        dueDate: privateFocus.dueDate!,
        parent: null
      },
      {
        key: 'commitment:6',
        kind: 'commitment',
        focus: publicFocus,
        thread: privateThread,
        commitment: privateCommitment,
        dueDate: privateCommitment.dueDate!,
        parent: { kind: 'thread', title: privateThread.title, dueDate: privateThread.dueDate }
      }
    ]

    expect(dueWorkGroups(overview(items), false).flatMap(({ rows }) => rows)).toHaveLength(2)
    expect(dueWorkGroups(overview(items), true)).toEqual([])
  })
})
