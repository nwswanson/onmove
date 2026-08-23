import { describe, expect, it } from 'vitest'
import {
  ENTITY_REFERENCE_PREFIXES,
  entityReference
} from '../../src/shared/entity-reference'

describe('entityReference', () => {
  it('keeps every user-addressable record kind globally unambiguous', () => {
    expect(Object.values(ENTITY_REFERENCE_PREFIXES)).toEqual([
      'F', 'T', 'C', 'R', 'U', 'TD', 'N', 'S'
    ])
    expect(new Set(Object.values(ENTITY_REFERENCE_PREFIXES)).size)
      .toBe(Object.keys(ENTITY_REFERENCE_PREFIXES).length)
    expect(entityReference('focus', 2)).toBe('F.2')
    expect(entityReference('thread', 2)).toBe('T.2')
    expect(entityReference('update', 90)).toBe('U.90')
  })

  it('rejects ids that cannot name persisted records', () => {
    expect(() => entityReference('focus', 0)).toThrow('positive numeric id')
    expect(() => entityReference('thread', -1)).toThrow('positive numeric id')
    expect(() => entityReference('update', 'not-an-id')).toThrow('positive numeric id')
  })
})
