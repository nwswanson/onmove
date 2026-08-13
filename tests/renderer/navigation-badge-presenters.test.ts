import { describe, expect, it } from 'vitest'
import { navigationBadgeCounts } from '../../src/renderer/src/features/application/navigation-badge-presenters'

describe('navigationBadgeCounts', () => {
  const overview = {
    asOf: '2026-08-12',
    dueThrough: '2026-08-19',
    todos: { total: 4, nonSensitive: 3 },
    review: { total: 7, nonSensitive: 5 },
    routines: { total: 3, nonSensitive: 1 },
    due: { total: 6, nonSensitive: 2 }
  }

  it('selects total or non-sensitive partitions without exposing records to the shell', () => {
    expect(navigationBadgeCounts(overview, false)).toEqual({
      todos: 4, review: 7, routines: 3, due: 6
    })
    expect(navigationBadgeCounts(overview, true)).toEqual({
      todos: 3, review: 5, routines: 1, due: 2
    })
  })
})
