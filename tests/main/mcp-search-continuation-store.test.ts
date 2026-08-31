import { describe, expect, it } from 'vitest'
import { SearchContinuationStore } from '../../src/mcp/server'

describe('SearchContinuationStore', () => {
  it('issues short UUID handles and tolerates whitespace inserted by a client', () => {
    const store = new SearchContinuationStore()
    const handle = store.issue('complete-signed-cursor')
    const spaced = handle.split('').map((character, index) =>
      index > 0 && index % 5 === 0 ? ` \n${character}` : character).join('')

    expect(handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
    expect(store.resolve(spaced)).toBe('complete-signed-cursor')
  })

  it('expires handles without exposing or reconstructing their signed cursor', () => {
    let now = 1_000
    const store = new SearchContinuationStore({ ttlMs: 500, now: () => now })
    const handle = store.issue('sensitive-signed-cursor')

    now = 1_501
    expect(() => store.resolve(handle)).toThrow('SEARCH_CONTINUATION_EXPIRED')
  })

  it('retains default handles for three hours', () => {
    let now = 1_000
    const store = new SearchContinuationStore({ now: () => now })
    const handle = store.issue('three-hour-cursor')

    now += 3 * 60 * 60 * 1_000 - 1
    expect(store.resolve(handle)).toBe('three-hour-cursor')

    now += 1
    expect(() => store.resolve(handle)).toThrow('SEARCH_CONTINUATION_EXPIRED')
  })

  it('bounds retained handles and rejects valid but unknown UUIDs with recovery guidance', () => {
    const store = new SearchContinuationStore({ maximumEntries: 1 })
    const evicted = store.issue('first-cursor')
    const retained = store.issue('second-cursor')

    expect(() => store.resolve(evicted)).toThrow('SEARCH_CONTINUATION_EXPIRED_OR_UNKNOWN')
    expect(store.resolve(retained)).toBe('second-cursor')
    expect(() => store.resolve('00000000-0000-4000-8000-000000000001'))
      .toThrow('Restart the original search')
  })
})
