import { describe, expect, it } from 'vitest'
import type { CommitmentSnapshot } from '../../src/shared/contracts'
import {
  buildCommitmentListModel,
  commitmentCompletionModel,
  commitmentsForThreadSubject
} from '../../src/renderer/src/features/focus/commitment-list-model'

function commitment(
  id: number,
  status: CommitmentSnapshot['status'],
  state: CommitmentSnapshot['state']
): CommitmentSnapshot {
  return {
    id,
    parent: { type: 'focus', id: 1 },
    type: 'tracking',
    title: `Commitment ${id}`,
    status,
    state,
    dueDate: null,
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
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('buildCommitmentListModel', () => {
  it('orders active states, then paused records, then a combined closed group', () => {
    const input = [
      commitment(1, 'done', 'red'),
      commitment(2, 'active', 'none'),
      commitment(3, 'paused', 'red'),
      commitment(4, 'active', 'green'),
      commitment(5, 'cancelled', 'yellow'),
      commitment(6, 'active', 'red'),
      commitment(7, 'active', 'yellow')
    ]

    const model = buildCommitmentListModel(input)

    expect(model.ordered.map(({ id }) => id)).toEqual([6, 7, 4, 2, 3, 1, 5])
    expect(model.current.map(({ id }) => id)).toEqual([6, 7, 4, 2, 3])
    expect(model.closed.map(({ id }) => id)).toEqual([1, 5])
    expect(model.groups.map(({ id, label, commitments }) => ({
      id,
      label,
      commitmentIds: commitments.map((commitment) => commitment.id)
    }))).toEqual([
      { id: 'active', label: 'Active', commitmentIds: [6, 7, 4, 2] },
      { id: 'paused', label: 'Paused', commitmentIds: [3] },
      { id: 'closed', label: 'Done / Cancelled', commitmentIds: [1, 5] }
    ])
  })

  it('retains repository order for records with equal business priority', () => {
    const model = buildCommitmentListModel([
      commitment(8, 'active', 'red'),
      commitment(4, 'active', 'red'),
      commitment(7, 'paused', 'green'),
      commitment(3, 'paused', 'none'),
      commitment(9, 'cancelled', 'red'),
      commitment(2, 'done', 'none')
    ])

    expect(model.ordered.map(({ id }) => id)).toEqual([8, 4, 7, 3, 9, 2])
  })

  it('does not mutate the repository collection', () => {
    const first = commitment(1, 'paused', 'none')
    const second = commitment(2, 'active', 'red')
    const input = [first, second]

    buildCommitmentListModel(input)

    expect(input).toEqual([first, second])
  })

  it('exposes a one-way completion affordance only for due-dated commitments', () => {
    expect(commitmentCompletionModel({ dueDate: null, status: 'active' })).toEqual({
      visible: false,
      checked: false,
      disabled: true
    })
    expect(commitmentCompletionModel({ dueDate: '2026-09-15', status: 'active' })).toEqual({
      visible: true,
      checked: false,
      disabled: false
    })
    expect(commitmentCompletionModel({ dueDate: '2026-09-15', status: 'paused' })).toEqual({
      visible: true,
      checked: false,
      disabled: false
    })
    expect(commitmentCompletionModel({ dueDate: '2026-09-15', status: 'done' })).toEqual({
      visible: true,
      checked: true,
      disabled: true
    })
    expect(commitmentCompletionModel({ dueDate: '2026-09-15', status: 'cancelled' })).toEqual({
      visible: true,
      checked: false,
      disabled: true
    })
  })

  it('projects only matching Commitment cells into a Thread Subject lens', () => {
    const included = commitment(1, 'active', 'green')
    const excluded = commitment(2, 'active', 'yellow')
    const projected = commitmentsForThreadSubject([included, excluded], {
      scopeId: 10,
      subjectId: 20,
      subject: {
        id: 20,
        kind: 'generic',
        name: 'Customer Operations',
        description: null,
        externalKey: null,
        sensitive: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      state: 'yellow',
      lastReviewDate: '2026-01-08',
      nextReviewDate: '2026-01-15',
      reviewDue: false,
      commitments: [{
        commitmentId: included.id,
        scopeId: 11,
        subjectId: 20,
        state: 'red',
        lastUpdateDate: '2026-01-07',
        nextUpdateDate: '2026-01-14',
        needsUpdate: true
      }]
    })

    expect(projected).toEqual([
      expect.objectContaining({
        id: included.id,
        state: 'red',
        lastUpdateDate: '2026-01-07',
        needsUpdate: true
      })
    ])
    expect(included.state).toBe('green')
  })
})
