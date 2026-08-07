import { describe, expect, it } from 'vitest'
import type { CommitmentSnapshot } from '../../src/shared/contracts'
import { buildCommitmentListModel } from '../../src/renderer/src/features/focus/commitment-list-model'

function commitment(
  id: number,
  status: CommitmentSnapshot['status'],
  state: CommitmentSnapshot['state']
): CommitmentSnapshot {
  return {
    id,
    parent: { type: 'focus', id: 1 },
    type: 'ongoing',
    title: `Commitment ${id}`,
    status,
    state,
    dueDate: null,
    cadenceDays: null,
    lastUpdateDate: null,
    nextUpdateDate: null,
    needsUpdate: false,
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
})
