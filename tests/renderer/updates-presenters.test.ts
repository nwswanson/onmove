import { describe, expect, it } from 'vitest'
import type { UpdateSnapshot } from '../../src/shared/contracts'
import {
  UPDATE_LIST_STATE_OPTIONS,
  updateListItems,
  updateListProjection
} from '../../src/renderer/src/features/updates/updates-presenters'

describe('Update presenters', () => {
  it('maps domain updates and state semantics into the card-list receiver contract', () => {
    const update: UpdateSnapshot = {
      id: 8,
      parent: { type: 'commitment', id: 3 },
      date: '2026-08-07',
      observation: 'Ticket quality improved',
      state: 'green',
      sensitive: false,
      scope: null,
      createdAt: '2026-08-07T12:00:00.000Z',
      updatedAt: '2026-08-07T12:00:00.000Z'
    }

    expect(updateListItems([update])).toEqual([
      {
        id: '8',
        date: '2026-08-07',
        observation: 'Ticket quality improved',
        state: 'green',
        sensitive: false,
        historyReference: {
          type: 'update',
          id: 8,
          field: 'observation'
        }
      }
    ])
    expect(UPDATE_LIST_STATE_OPTIONS).toEqual([
      { value: 'red', label: 'Red', tone: 'danger' },
      { value: 'yellow', label: 'Yellow', tone: 'warning' },
      { value: 'green', label: 'Green', tone: 'success' },
      { value: 'none', label: 'None', tone: 'neutral' }
    ])
  })

  it('exposes only receiver-declared external observation revisions to the editor', () => {
    const update: UpdateSnapshot = {
      id: 8,
      parent: { type: 'commitment', id: 3 },
      date: '2026-08-07',
      observation: 'Changed in another window',
      state: 'green',
      sensitive: false,
      scope: null,
      createdAt: '2026-08-07T12:00:00.000Z',
      updatedAt: '2026-08-07T12:00:05.000Z'
    }

    expect(updateListProjection([update], {
      subjectLabels: new Map(),
      externalObservationRevisions: new Map([[8, 3]])
    }).items[0]).toMatchObject({ externalRevision: 3 })
  })

  it('labels retained evidence from a former Scope without dropping the card', () => {
    const update: UpdateSnapshot = {
      id: 9,
      parent: { type: 'thread', id: 4 },
      date: '2026-08-07',
      observation: 'Customer review before the Scope changed',
      state: 'yellow',
      sensitive: false,
      scope: { scopeId: 50, subjectId: 40 },
      createdAt: '2026-08-07T12:00:00.000Z',
      updatedAt: '2026-08-07T12:00:00.000Z'
    }

    expect(updateListProjection([update], {
      subjectLabels: new Map([[40, 'Customer Operations']]),
      currentSubjectIds: new Set()
    })).toEqual({
      items: [],
      formerItems: [expect.objectContaining({
          id: '9',
          contextLabel: 'Customer Operations · Former scope'
        })]
    })
  })

  it('restores current classification when the canonical Subject is re-applied through a new Scope', () => {
    const update: UpdateSnapshot = {
      id: 10,
      parent: { type: 'thread', id: 4 },
      date: '2026-08-07',
      observation: 'Customer review from the previous overlay',
      state: 'green',
      sensitive: false,
      scope: { scopeId: 50, subjectId: 40 },
      createdAt: '2026-08-07T12:00:00.000Z',
      updatedAt: '2026-08-07T12:00:00.000Z'
    }

    expect(updateListProjection([update], {
      subjectLabels: new Map([[40, 'Customer Operations']]),
      currentSubjectIds: new Set([40])
    })).toEqual({
      items: [expect.objectContaining({
        id: '10',
        contextLabel: 'Customer Operations'
      })],
      formerItems: []
    })
  })

  it('moves evidence from a former Open application out of a bounded current list', () => {
    const unscopedUpdate: UpdateSnapshot = {
      id: 11,
      parent: { type: 'thread', id: 4 },
      date: '2026-08-07',
      observation: 'Thread-wide evidence before Subjects were applied',
      state: 'none',
      sensitive: false,
      scope: null,
      createdAt: '2026-08-07T12:00:00.000Z',
      updatedAt: '2026-08-07T12:00:00.000Z'
    }

    expect(updateListProjection([unscopedUpdate], {
      subjectLabels: new Map(),
      currentSubjectIds: new Set([40])
    })).toEqual({
      items: [],
      formerItems: [expect.objectContaining({
        id: '11',
        contextLabel: 'Former scope'
      })]
    })
  })
})
