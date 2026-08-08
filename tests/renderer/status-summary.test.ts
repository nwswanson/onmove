import { describe, expect, it, vi } from 'vitest'
import type {
  CommitmentSnapshot,
  DomainApi,
  ThreadSnapshot,
  UpdateSnapshot
} from '../../src/shared/contracts'
import {
  buildStatusSummary,
  loadFocusStatusSummary,
  loadThreadStatusSummary,
  statusSummaryForVisibility
} from '../../src/renderer/src/features/shared/status-summary'

function commitment(overrides: Partial<CommitmentSnapshot>): CommitmentSnapshot {
  return {
    id: 1,
    parent: { type: 'focus', id: 1 },
    type: 'ongoing',
    title: 'Commitment',
    status: 'active',
    state: 'none',
    dueDate: null,
    cadenceDays: null,
    lastUpdateDate: null,
    nextUpdateDate: null,
    needsUpdate: false,
    sensitive: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function update(overrides: Partial<UpdateSnapshot>): UpdateSnapshot {
  return {
    id: 1,
    parent: { type: 'focus', id: 1 },
    date: '2026-01-01',
    observation: '',
    state: 'none',
    sensitive: false,
    scope: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function thread(id: number): ThreadSnapshot {
  return {
    id,
    focusId: 1,
    title: `Thread ${id}`,
    health: 'none',
    status: 'active',
    reviewFrequencyDays: 7,
    lastReviewDate: null,
    nextReviewDate: '2026-01-08',
    needsReview: true,
    reviewDue: false,
    sensitive: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

type StatusSource = Pick<DomainApi, 'listThreads' | 'listCommitments' | 'listUpdates'>

describe('status Sunflower summary', () => {
  it('recomputes visible status without sensitive Updates or Commitment branches', () => {
    const summary = buildStatusSummary(
      [
        update({ id: 1, date: '2026-02-01', state: 'green' }),
        update({ id: 2, date: '2026-02-02', state: 'red', sensitive: true })
      ],
      [
        commitment({ id: 10, title: 'Public', state: 'green' }),
        commitment({ id: 11, title: 'Private', state: 'red', sensitive: true })
      ]
    )
    const withHiddenAncestor = {
      ...summary,
      activeCommitments: [
        ...summary.activeCommitments,
        {
          id: 12,
          title: 'Public child',
          state: 'yellow' as const,
          sensitive: false,
          ancestorSensitive: true
        }
      ]
    }

    expect(statusSummaryForVisibility(withHiddenAncestor, true)).toMatchObject({
      overallState: 'green',
      activeCommitments: [
        expect.objectContaining({ id: 10, title: 'Public' })
      ]
    })
  })

  it('uses the latest direct Update and only unique active Commitments', () => {
    const active = commitment({ id: 10, title: 'Active signal', state: 'red' })
    const summary = buildStatusSummary(
      [
        update({ id: 1, date: '2026-02-01', state: 'yellow' }),
        update({ id: 3, date: '2026-02-02', state: 'green' }),
        update({ id: 4, date: '2026-02-02', state: 'red' })
      ],
      [
        active,
        active,
        commitment({ id: 11, status: 'paused', state: 'yellow' }),
        commitment({ id: 12, status: 'done', state: 'green' })
      ]
    )

    expect(summary).toEqual({
      overallState: 'red',
      activeCommitments: [
        {
          id: 10,
          title: 'Active signal',
          state: 'red',
          sensitive: false,
          ancestorSensitive: false
        }
      ],
      directUpdates: [
        { id: 1, date: '2026-02-01', state: 'yellow', sensitive: false },
        { id: 3, date: '2026-02-02', state: 'green', sensitive: false },
        { id: 4, date: '2026-02-02', state: 'red', sensitive: false }
      ]
    })
  })

  it('collects Focus-level and nested Thread Commitments in one Focus summary', async () => {
    const direct = commitment({ id: 10, title: 'Direct', state: 'green' })
    const nested = commitment({
      id: 11,
      parent: { type: 'thread', id: 20 },
      title: 'Nested',
      state: 'yellow'
    })
    const source: StatusSource = {
      listThreads: vi.fn().mockResolvedValue([thread(20)]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'focus' ? [direct] : [nested]
      ),
      listUpdates: vi.fn().mockResolvedValue([
        update({ date: '2099-12-31', state: 'green' })
      ])
    }

    await expect(loadFocusStatusSummary(source, 1)).resolves.toEqual({
      overallState: 'green',
      activeCommitments: [
        {
          id: 10,
          title: 'Direct',
          state: 'green',
          sensitive: false,
          ancestorSensitive: false
        },
        {
          id: 11,
          title: 'Nested',
          state: 'yellow',
          sensitive: false,
          ancestorSensitive: false
        }
      ],
      directUpdates: [
        { id: 1, date: '2099-12-31', state: 'green', sensitive: false }
      ]
    })
    expect(source.listCommitments).toHaveBeenCalledWith({ type: 'focus', id: 1 })
    expect(source.listCommitments).toHaveBeenCalledWith({ type: 'thread', id: 20 })
  })

  it('marks nested Commitment signals with their Thread sensitivity', async () => {
    const sensitiveThread = { ...thread(20), sensitive: true }
    const nested = commitment({
      id: 11,
      parent: { type: 'thread', id: sensitiveThread.id },
      title: 'Nested public record'
    })
    const source: StatusSource = {
      listThreads: vi.fn().mockResolvedValue([sensitiveThread]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'focus' ? [] : [nested]
      ),
      listUpdates: vi.fn().mockResolvedValue([])
    }

    const summary = await loadFocusStatusSummary(source, 1)
    expect(summary.activeCommitments).toEqual([
      expect.objectContaining({ id: nested.id, ancestorSensitive: true })
    ])
    expect(statusSummaryForVisibility(summary, true).activeCommitments).toEqual([])
  })

  it('loads a direct Thread summary without including descendants of another parent', async () => {
    const source: StatusSource = {
      listThreads: vi.fn(),
      listCommitments: vi.fn().mockResolvedValue([
        commitment({ id: 12, parent: { type: 'thread', id: 20 }, state: 'none' })
      ]),
      listUpdates: vi.fn().mockResolvedValue([
        update({ parent: { type: 'thread', id: 20 }, state: 'yellow' })
      ])
    }

    await expect(loadThreadStatusSummary(source, 20)).resolves.toEqual({
      overallState: 'yellow',
      activeCommitments: [
        {
          id: 12,
          title: 'Commitment',
          state: 'none',
          sensitive: false,
          ancestorSensitive: false
        }
      ],
      directUpdates: [
        { id: 1, date: '2026-01-01', state: 'yellow', sensitive: false }
      ]
    })
    expect(source.listThreads).not.toHaveBeenCalled()
  })
})
