import { describe, expect, it } from 'vitest'
import { RetrievalContinuationStore, SearchContinuationStore } from '../../src/mcp/server'

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

describe('RetrievalContinuationStore', () => {
  it('issues only a UUID handle and tolerates whitespace inserted by a client', () => {
    const store = new RetrievalContinuationStore()
    const signedToken = 'onmove-retrieval-v2.private-signed-state'
    const handle = store.issue(signedToken)
    const spaced = handle.split('').map((character, index) =>
      index > 0 && index % 5 === 0 ? ` \n${character}` : character).join('')

    expect(handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
    expect(handle).not.toContain('onmove-retrieval-v2.')
    expect(store.resolve(spaced)).toBe(signedToken)
  })

  it('rejects legacy public payloads and valid but unknown UUIDs', () => {
    const store = new RetrievalContinuationStore()

    expect(() => store.resolve('onmove-retrieval-v2.eyJ2ZXJzaW9uIjoyfQ.signature'))
      .toThrow('RETRIEVAL_CONTINUATION_INVALID')
    expect(() => store.resolve('00000000-0000-4000-8000-000000000001'))
      .toThrow('RETRIEVAL_CONTINUATION_EXPIRED_OR_UNKNOWN')
  })

  it('retains handles for three hours without extending expiry when replayed', () => {
    let now = 1_000
    const store = new RetrievalContinuationStore({ now: () => now })
    const handle = store.issue('three-hour-retrieval-cursor')

    now += 3 * 60 * 60 * 1_000 - 1
    expect(store.resolve(handle)).toBe('three-hour-retrieval-cursor')
    expect(store.resolve(handle)).toBe('three-hour-retrieval-cursor')

    now += 1
    expect(() => store.resolve(handle)).toThrow('RETRIEVAL_CONTINUATION_EXPIRED')
  })

  it('bounds retained handles', () => {
    const store = new RetrievalContinuationStore({ maximumEntries: 1 })
    const evicted = store.issue('first-retrieval-cursor')
    const retained = store.issue('second-retrieval-cursor')

    expect(() => store.resolve(evicted)).toThrow('RETRIEVAL_CONTINUATION_EXPIRED_OR_UNKNOWN')
    expect(store.resolve(retained)).toBe('second-retrieval-cursor')
  })
})
