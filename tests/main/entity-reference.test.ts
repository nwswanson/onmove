import { describe, expect, it } from 'vitest'
import {
  ENTITY_REFERENCE_PREFIXES,
  entityReference,
  parseEntityReference
} from '../../src/shared/entity-reference'

describe('entityReference', () => {
  it('uses collision-free canonical hash-prefixed references', () => {
    expect(new Set(Object.values(ENTITY_REFERENCE_PREFIXES)).size).toBe(8)
    expect(entityReference('focus', 2)).toBe('#F2')
    expect(entityReference('thread', 4)).toBe('#T4')
    expect(entityReference('update', 90)).toBe('#U90')
    expect(entityReference('todo', 11)).toBe('#TD11')
  })

  it('parses canonical and tolerant user input into a canonical reference', () => {
    expect(parseEntityReference('#T4')).toEqual({ kind: 'thread', id: 4, code: '#T4' })
    expect(parseEntityReference('td11')).toEqual({ kind: 'todo', id: 11, code: '#TD11' })
    expect(parseEntityReference('#F0')).toBeNull()
    expect(parseEntityReference('#X2')).toBeNull()
  })

  it('rejects invalid ids', () => {
    expect(() => entityReference('focus', 0)).toThrow('positive numeric id')
    expect(() => entityReference('thread', -1)).toThrow('positive numeric id')
    expect(() => entityReference('update', 'not-an-id')).toThrow('positive numeric id')
  })
})
