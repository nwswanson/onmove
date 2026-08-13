import { describe, expect, it } from 'vitest'
import type {
  CommitmentSnapshot,
  CommitmentWorkingContextSnapshot,
  FocusSnapshot,
  ReviewQueueItemSnapshot,
  SubjectSnapshot,
  ThreadScopeSnapshot,
  ThreadSnapshot
} from '../../src/shared/contracts'
import {
  reviewUpdateCommandTarget,
  updateCommandGroups,
  type UpdateCommandGraph
} from '../../src/renderer/src/features/updates/update-command-presenters'

function focus(overrides: Partial<FocusSnapshot> = {}): FocusSnapshot {
  return {
    id: 1,
    kind: 'generic',
    title: 'Project Atlas',
    description: null,
    goal: '',
    status: 'active',
    dueDate: null,
    statusChangedAt: '2026-08-01T12:00:00.000Z',
    lastReviewDate: null,
    needsReview: true,
    sensitive: false,
    notes: [],
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  }
}

function thread(overrides: Partial<ThreadSnapshot> = {}): ThreadSnapshot {
  return {
    id: 10,
    focusId: 1,
    title: 'Sprint execution',
    health: 'none',
    status: 'active',
    dueDate: null,
    reviewFrequencyDays: 7,
    lastReviewDate: null,
    nextReviewDate: '2026-08-08',
    needsReview: true,
    reviewDue: false,
    sensitive: false,
    notes: [],
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  }
}

function commitment(overrides: Partial<CommitmentSnapshot> = {}): CommitmentSnapshot {
  return {
    id: 20,
    parent: { type: 'thread', id: 10 },
    type: 'tracking',
    title: 'Improve ticket quality',
    status: 'active',
    state: 'none',
    dueDate: null,
    cadenceDays: null,
    reviewFrequencyDays: 7,
    lastReviewDate: null,
    nextReviewDate: '2026-08-08',
    needsReview: true,
    reviewDue: false,
    lastUpdateDate: null,
    nextUpdateDate: null,
    needsUpdate: false,
    sensitive: false,
    notes: [],
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  }
}

function subject(id: number, name: string, sensitive = false): SubjectSnapshot {
  return {
    id,
    kind: 'generic',
    name,
    description: null,
    externalKey: null,
    sensitive,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z'
  }
}

function scopedThread(
  record: ThreadSnapshot,
  subjects: SubjectSnapshot[]
): ThreadScopeSnapshot {
  return {
    threadId: record.id,
    focusId: record.focusId,
    mode: 'explicit',
    scopeId: 50,
    subjects,
    focusSubjects: []
  }
}

function scopedCommitment(
  record: CommitmentSnapshot,
  subjects: SubjectSnapshot[]
): CommitmentWorkingContextSnapshot {
  return {
    commitmentId: record.id,
    scopeId: 50,
    cells: subjects.map((current) => ({
      scopeId: 50,
      subjectId: current.id,
      subject: current,
      state: 'none',
      lastReviewDate: null,
      nextReviewDate: '2026-08-08',
      reviewDue: false,
      lastUpdateDate: null,
      nextUpdateDate: null,
      needsUpdate: false
    }))
  }
}

function graph(overrides: Partial<UpdateCommandGraph> = {}): UpdateCommandGraph {
  return {
    focuses: [],
    threads: [],
    commitments: [],
    threadScopes: new Map(),
    commitmentContexts: new Map(),
    ...overrides
  }
}

describe('update command presenters', () => {
  it('maps the active review item directly to its exact composer target', () => {
    const currentFocus = focus()
    const currentThread = thread()
    const currentCommitment = commitment()
    const currentSubject = subject(61, 'Customer Operations')
    const reviewItem: ReviewQueueItemSnapshot = {
      key: 'commitment:20:scope:50:subject:61',
      kind: 'commitment',
      focus: currentFocus,
      thread: currentThread,
      commitment: currentCommitment,
      cell: { scopeId: 50, subjectId: 61, subject: currentSubject },
      lastReviewDate: null,
      nextReviewDate: '2026-08-08',
      due: true,
      state: 'none',
      updates: [],
      commitments: []
    }

    expect(reviewUpdateCommandTarget(reviewItem)).toEqual({
      id: 'commitment:20:scope:50:subject:61',
      kind: 'commitment',
      focusId: 1,
      parent: { type: 'commitment', id: 20 },
      scope: { scopeId: 50, subjectId: 61 },
      label: 'Improve ticket quality',
      description: 'Project Atlas › Sprint execution › Customer Operations',
      keywords: [
        'commitment', 'Project Atlas', 'Sprint execution', 'Improve ticket quality',
        'subject', 'Customer Operations'
      ]
    })
  })

  it('expands bounded Threads and Commitments into exact Subject-cell targets', () => {
    const currentFocus = focus()
    const currentThread = thread()
    const currentCommitment = commitment()
    const subjects = [subject(61, 'Customer Operations'), subject(62, 'Platform')]

    const groups = updateCommandGroups(graph({
      focuses: [currentFocus],
      threads: [currentThread],
      commitments: [currentCommitment],
      threadScopes: new Map([[currentThread.id, scopedThread(currentThread, subjects)]]),
      commitmentContexts: new Map([[
        currentCommitment.id,
        scopedCommitment(currentCommitment, subjects)
      ]])
    }), false)

    expect(groups.map(({ label }) => label)).toEqual(['Focuses', 'Threads', 'Commitments'])
    const threadItems = groups.find(({ id }) => id === 'threads')?.items ?? []
    const commitmentItems = groups.find(({ id }) => id === 'commitments')?.items ?? []
    expect(threadItems.map(({ id }) => id)).toEqual([
      'thread:10:scope:50:subject:61',
      'thread:10:scope:50:subject:62'
    ])
    expect(commitmentItems.map(({ id }) => id)).toEqual([
      'commitment:20:scope:50:subject:61',
      'commitment:20:scope:50:subject:62'
    ])
    expect(commitmentItems[0]?.target).toMatchObject({
      parent: { type: 'commitment', id: 20 },
      scope: { scopeId: 50, subjectId: 61 },
      description: 'Project Atlas › Sprint execution › Customer Operations'
    })
    expect(threadItems).not.toContainEqual(expect.objectContaining({ id: 'thread:10' }))
    expect(commitmentItems).not.toContainEqual(expect.objectContaining({ id: 'commitment:20' }))
  })

  it('offers one unscoped target for open records and filters hidden hierarchy branches', () => {
    const publicFocus = focus()
    const privateFocus = focus({ id: 2, title: 'Private', sensitive: true })
    const openThread = thread()
    const privateThread = thread({ id: 11, title: 'Private Thread', sensitive: true })
    const openCommitment = commitment()
    const closedCommitment = commitment({ id: 21, title: 'Finished', status: 'done' })
    const privateCommitment = commitment({ id: 22, title: 'Private work', sensitive: true })
    const openScope: ThreadScopeSnapshot = {
      threadId: openThread.id,
      focusId: openThread.focusId,
      mode: 'open',
      scopeId: null,
      subjects: [],
      focusSubjects: []
    }
    const openContext = (id: number): CommitmentWorkingContextSnapshot => ({
      commitmentId: id,
      scopeId: null,
      cells: []
    })

    const groups = updateCommandGroups(graph({
      focuses: [publicFocus, privateFocus],
      threads: [openThread, privateThread],
      commitments: [openCommitment, closedCommitment, privateCommitment],
      threadScopes: new Map([
        [openThread.id, openScope],
        [privateThread.id, { ...openScope, threadId: privateThread.id }]
      ]),
      commitmentContexts: new Map([
        [openCommitment.id, openContext(openCommitment.id)],
        [closedCommitment.id, openContext(closedCommitment.id)],
        [privateCommitment.id, openContext(privateCommitment.id)]
      ])
    }), true)

    expect(groups.flatMap(({ items }) => items.map(({ id }) => id))).toEqual([
      'focus:1',
      'thread:10',
      'commitment:20'
    ])
  })

  it('removes sensitive Subject cells only when sensitive content is hidden', () => {
    const currentFocus = focus()
    const currentThread = thread()
    const currentCommitment = commitment()
    const subjects = [subject(61, 'Public'), subject(62, 'Executive', true)]
    const snapshot = graph({
      focuses: [currentFocus],
      threads: [currentThread],
      commitments: [currentCommitment],
      threadScopes: new Map([[currentThread.id, scopedThread(currentThread, subjects)]]),
      commitmentContexts: new Map([[
        currentCommitment.id,
        scopedCommitment(currentCommitment, subjects)
      ]])
    })

    expect(updateCommandGroups(snapshot, false).flatMap(({ items }) => items))
      .toHaveLength(5)
    const hidden = updateCommandGroups(snapshot, true).flatMap(({ items }) => items)
    expect(hidden).toHaveLength(3)
    expect(hidden.some(({ description }) => description.includes('Executive'))).toBe(false)
  })

  it('does not offer an invalid unscoped Commitment target for a bounded empty Scope', () => {
    const currentFocus = focus()
    const currentThread = thread()
    const currentCommitment = commitment()
    const groups = updateCommandGroups(graph({
      focuses: [currentFocus],
      threads: [currentThread],
      commitments: [currentCommitment],
      threadScopes: new Map([[currentThread.id, {
        threadId: currentThread.id,
        focusId: currentFocus.id,
        mode: 'explicit',
        scopeId: 50,
        subjects: [],
        focusSubjects: []
      }]]),
      commitmentContexts: new Map([[currentCommitment.id, {
        commitmentId: currentCommitment.id,
        scopeId: 50,
        cells: []
      }]])
    }), false)

    expect(groups.flatMap(({ items }) => items.map(({ id }) => id)))
      .toEqual(['focus:1', 'thread:10'])
  })
})
