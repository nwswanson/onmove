import { describe, expect, it } from 'vitest'
import type { UpdateSnapshot } from '../../src/shared/contracts'
import {
  UPDATE_LIST_STATE_OPTIONS,
  updateListItems
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
      createdAt: '2026-08-07T12:00:00.000Z'
    }

    expect(updateListItems([update])).toEqual([
      {
        id: '8',
        date: '2026-08-07',
        observation: 'Ticket quality improved',
        state: 'green',
        sensitive: false
      }
    ])
    expect(UPDATE_LIST_STATE_OPTIONS).toEqual([
      { value: 'red', label: 'Red', tone: 'danger' },
      { value: 'yellow', label: 'Yellow', tone: 'warning' },
      { value: 'green', label: 'Green', tone: 'success' },
      { value: 'none', label: 'None', tone: 'neutral' }
    ])
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
      createdAt: '2026-08-07T12:00:00.000Z'
    }

    expect(updateListItems([update], {
      subjectLabels: new Map([[40, 'Customer Operations']]),
      currentSubjectIds: new Set()
    }))
      .toEqual([expect.objectContaining({
        id: '9',
        contextLabel: 'Customer Operations · Former scope'
      })])
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
      createdAt: '2026-08-07T12:00:00.000Z'
    }

    expect(updateListItems([update], {
      subjectLabels: new Map([[40, 'Customer Operations']]),
      currentSubjectIds: new Set([40])
    })).toEqual([expect.objectContaining({
      id: '10',
      contextLabel: 'Customer Operations'
    })])
  })
})
