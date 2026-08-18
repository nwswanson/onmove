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
    type: 'tracking',
    title: 'Improve ticket quality',
    status: 'active',
    state: 'green',
    dueDate: '2026-08-12',
    cadenceDays: null,
    reviewFrequencyDays: 7,
    lastReviewDate: null,
    nextReviewDate: '2026-01-08',
    needsReview: true,
    reviewDue: false,
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
  const monthCommitment = commitment({ id: 4, title: 'Prepare launch brief' })
  const upcomingCommitment = commitment({ id: 5, title: 'Archive the rollout' })
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
    },
    {
      key: 'commitment:4',
      kind: 'commitment',
      focus: currentFocus,
      thread: currentThread,
      commitment: monthCommitment,
      dueDate: '2026-08-20',
      parent: { kind: 'thread', title: currentThread.title, dueDate: currentThread.dueDate }
    },
    {
      key: 'commitment:5',
      kind: 'commitment',
      focus: currentFocus,
      thread: currentThread,
      commitment: upcomingCommitment,
      dueDate: '2026-09-01',
      parent: { kind: 'thread', title: currentThread.title, dueDate: currentThread.dueDate }
    }
  ]), { hideSensitiveContent: false, hidePaused: false })

  expect(groups.map(({ id, rows }) => ({ id, rows: rows.map(({ id: rowId }) => rowId) })))
    .toEqual([
      { id: 'past-due', rows: ['thread:2'] },
      { id: 'today', rows: ['focus:1'] },
      { id: 'this-week', rows: ['commitment:3'] },
      { id: 'this-month', rows: ['commitment:4'] },
      { id: 'upcoming', rows: ['commitment:5'] }
    ])
  expect(groups[2].rows[0]).toMatchObject({
    title: 'Improve ticket quality',
    locationLabel: 'Project Atlas › Sprint execution',
    status: 'active',
    parent: { label: 'Thread', dueDate: '2026-08-09' },
    destination: { focusId: 1, threadId: 2, commitmentId: 3, subjectId: null }
  })
})

it('uses the current Sunday-through-Saturday week and calendar month boundaries', () => {
  const currentFocus = focus({ dueDate: '2026-08-30' })
  const items = [
    { id: 10, date: '2026-08-31', title: 'Monday handoff' },
    { id: 11, date: '2026-09-05', title: 'Saturday checkpoint' },
    { id: 12, date: '2026-09-06', title: 'Next Sunday' }
  ].map(({ id, date, title }): DueWorkItemSnapshot => ({
    key: `commitment:${id}`,
    kind: 'commitment',
    focus: currentFocus,
    thread: null,
    commitment: commitment({ id, title, dueDate: date }),
    dueDate: date,
    parent: { kind: 'focus', title: currentFocus.title, dueDate: currentFocus.dueDate }
  }))
  const sundayOverview: DueOverviewSnapshot = { asOf: '2026-08-30', items }

  expect(dueWorkGroups(sundayOverview, {
    hideSensitiveContent: false,
    hidePaused: false
  }).map(({ id, rows }) => ({ id, titles: rows.map(({ title }) => title) }))).toEqual([
    { id: 'this-week', titles: ['Monday handoff', 'Saturday checkpoint'] },
    { id: 'upcoming', titles: ['Next Sunday'] }
  ])

  const saturdayOverview: DueOverviewSnapshot = {
    asOf: '2026-08-29',
    items: [items[0]]
  }
  expect(dueWorkGroups(saturdayOverview, {
    hideSensitiveContent: false,
    hidePaused: false
  })[0].id).toBe('this-month')
})

describe('due-work visibility', () => {
  it('always removes closed work and optionally removes paused work', () => {
    const currentFocus = focus()
    const items: DueWorkItemSnapshot[] = [
      {
        key: 'focus:1',
        kind: 'focus',
        focus: currentFocus,
        thread: null,
        commitment: null,
        dueDate: currentFocus.dueDate!,
        parent: null
      },
      ...(['paused', 'done', 'cancelled'] as const).map((status, index) => {
        const record = commitment({ id: index + 10, status, title: status })
        return {
          key: `commitment:${record.id}`,
          kind: 'commitment' as const,
          focus: currentFocus,
          thread: null,
          commitment: record,
          dueDate: record.dueDate!,
          parent: { kind: 'focus' as const, title: currentFocus.title, dueDate: currentFocus.dueDate }
        }
      })
    ]

    expect(dueWorkGroups(overview(items), {
      hideSensitiveContent: false,
      hidePaused: false
    }).flatMap(({ rows }) => rows).map(({ title }) => title)).toEqual([
      'Project Atlas',
      'paused'
    ])
    expect(dueWorkGroups(overview(items), {
      hideSensitiveContent: false,
      hidePaused: true
    }).flatMap(({ rows }) => rows).map(({ title }) => title)).toEqual(['Project Atlas'])
  })

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

    expect(dueWorkGroups(overview(items), {
      hideSensitiveContent: false,
      hidePaused: false
    }).flatMap(({ rows }) => rows)).toHaveLength(2)
    expect(dueWorkGroups(overview(items), {
      hideSensitiveContent: true,
      hidePaused: false
    })).toEqual([])
  })
})
