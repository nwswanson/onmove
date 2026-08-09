import { describe, expect, it } from 'vitest'
import type { UpdateSnapshot } from '../../src/shared/contracts'
import { updatesForWorkingContext } from '../../src/renderer/src/features/updates/use-updates-model'

function update(
  id: number,
  scope: UpdateSnapshot['scope']
): UpdateSnapshot {
  return {
    id,
    parent: { type: 'thread', id: 1 },
    date: '2026-08-08',
    observation: `Update ${id}`,
    state: 'none',
    sensitive: false,
    scope,
    createdAt: '2026-08-08T12:00:00.000Z'
  }
}

describe('updatesForWorkingContext', () => {
  const updates = [
    update(1, null),
    update(2, { scopeId: 10, subjectId: 20 }),
    update(3, { scopeId: 10, subjectId: 21 }),
    update(4, { scopeId: 11, subjectId: 20 })
  ]

  it('separates unscoped, complete Scope history, and exact-cell evidence', () => {
    expect(updatesForWorkingContext(updates, { mode: 'unscoped' }).map(({ id }) => id))
      .toEqual([1])
    expect(updatesForWorkingContext(updates, {
      mode: 'scope-overview'
    }).map(({ id }) => id)).toEqual([1, 2, 3, 4])
    expect(updatesForWorkingContext(updates, {
      mode: 'cell',
      cell: { scopeId: 10, subjectId: 20 }
    }).map(({ id }) => id)).toEqual([2])
  })

  it('does not mutate the complete retained history', () => {
    expect(updatesForWorkingContext(updates, { mode: 'unfiltered' })).toEqual(updates)
    expect(updates).toHaveLength(4)
  })
})
