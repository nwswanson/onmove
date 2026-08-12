import { describe, expect, it } from 'vitest'
import type {
  CommitmentSnapshot,
  FocusSnapshot,
  NoteSnapshot,
  ReviewQueueItemSnapshot,
  ThreadSnapshot
} from '../../src/shared/contracts'
import {
  reviewItemIsVisible,
  reviewItemModel
} from '../../src/renderer/src/features/review/review-presenters'

const focus: FocusSnapshot = {
  id: 1,
  kind: 'generic',
  title: 'Project Atlas',
  description: 'A measured rollout',
  goal: 'Ship safely',
  status: 'active',
  dueDate: null,
  statusChangedAt: '2026-01-01T00:00:00.000Z',
  lastReviewDate: null,
  needsReview: true,
  sensitive: false,
  notes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const defaultNote: NoteSnapshot = {
  id: 7,
  parent: { type: 'thread', id: 2 },
  title: 'Default',
  content: 'Working review notes',
  revision: 3,
  sort: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z'
}

const thread: ThreadSnapshot = {
  id: 2,
  focusId: 1,
  title: 'Sprint execution',
  health: 'yellow',
  status: 'active',
  dueDate: '2026-01-31',
  reviewFrequencyDays: 7,
  lastReviewDate: null,
  nextReviewDate: '2026-01-08',
  needsReview: true,
  reviewDue: true,
  sensitive: false,
  notes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const commitment: CommitmentSnapshot = {
  id: 3,
  parent: { type: 'thread', id: 2 },
  type: 'ongoing',
  title: 'Improve ticket quality',
  status: 'active',
  state: 'red',
  dueDate: null,
  cadenceDays: 7,
  lastReviewDate: null,
  lastUpdateDate: null,
  nextUpdateDate: '2026-01-08',
  needsUpdate: true,
  sensitive: false,
  notes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function item(overrides: Partial<ReviewQueueItemSnapshot> = {}): ReviewQueueItemSnapshot {
  return {
    key: 'thread:2',
    kind: 'thread',
    focus,
    thread,
    commitment: null,
    cell: null,
    lastReviewDate: null,
    nextReviewDate: '2026-01-08',
    due: true,
    state: 'yellow',
    updates: [],
    commitments: [commitment],
    ...overrides
  }
}

describe('review presenters', () => {
  it('projects compact non-navigating supporting details', () => {
    const model = reviewItemModel(item({ thread: { ...thread, notes: [defaultNote] } }), false)

    expect(model).toMatchObject({
      kindLabel: 'Thread',
      title: 'Sprint execution',
      contextLabel: 'Project Atlas',
      lastReviewLabel: 'Never',
      nextReviewLabel: '2026-01-08',
      due: true,
      dueDate: '2026-01-31',
      state: { label: 'Yellow', tone: 'warning' },
      commitments: [{
        id: '3',
        title: 'Improve ticket quality',
        state: { label: 'Red', tone: 'danger' }
      }],
      defaultNote: {
        id: 7,
        title: 'Default',
        content: 'Working review notes'
      }
    })
  })

  it('only exposes the hardcoded Default note and tolerates a missing note', () => {
    expect(reviewItemModel(item({
      thread: {
        ...thread,
        notes: [{ ...defaultNote, id: 8, title: 'Planning' }, defaultNote]
      }
    }), false).defaultNote).toMatchObject({ id: 7, title: 'Default' })
    expect(reviewItemModel(item(), false).defaultNote).toBeNull()
  })

  it('applies sensitive ancestry to queue entries and supporting records', () => {
    expect(reviewItemIsVisible(item({ focus: { ...focus, sensitive: true } }), true)).toBe(false)
    expect(reviewItemIsVisible(item({
      cell: {
        scopeId: 10,
        subjectId: 11,
        subject: {
          id: 11,
          kind: 'person',
          name: 'Private person',
          description: null,
          externalKey: null,
          sensitive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      }
    }), true)).toBe(false)

    const model = reviewItemModel(item({
      commitments: [commitment, { ...commitment, id: 4, title: 'Private', sensitive: true }],
      updates: [{
        id: 5,
        parent: { type: 'thread', id: 2 },
        date: '2026-01-07',
        observation: 'Private update',
        state: 'green',
        sensitive: true,
        scope: null,
        createdAt: '2026-01-07T00:00:00.000Z',
        updatedAt: '2026-01-07T00:00:00.000Z'
      }]
    }), true)
    expect(model.commitments.map(({ title }) => title)).toEqual(['Improve ticket quality'])
    expect(model.updates).toEqual([])
  })
})
