import { describe, expect, it } from 'vitest'
import type { UpdateSnapshot } from '../../src/shared/contracts'
import {
  UPDATE_TABLE_STATE_OPTIONS,
  updateTableRows
} from '../../src/renderer/src/features/updates/updates-presenters'

describe('Update presenters', () => {
  it('maps domain updates and state semantics into the table receiver contract', () => {
    const update: UpdateSnapshot = {
      id: 8,
      parent: { type: 'commitment', id: 3 },
      date: '2026-08-07',
      observation: 'Ticket quality improved',
      state: 'green',
      createdAt: '2026-08-07T12:00:00.000Z'
    }

    expect(updateTableRows([update])).toEqual([
      {
        id: '8',
        date: '2026-08-07',
        observation: 'Ticket quality improved',
        state: 'green'
      }
    ])
    expect(UPDATE_TABLE_STATE_OPTIONS).toEqual([
      { value: 'red', label: 'Red', tone: 'danger' },
      { value: 'yellow', label: 'Yellow', tone: 'warning' },
      { value: 'green', label: 'Green', tone: 'success' },
      { value: 'none', label: 'None', tone: 'neutral' }
    ])
  })
})
