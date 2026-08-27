import { describe, expect, it, vi } from 'vitest'
import {
  clearCommandPagerIncludeClosed,
  commandPagerPreferenceStorage,
  loadCommandPagerIncludeClosed,
  saveCommandPagerIncludeClosed
} from '../../src/renderer/src/features/application/command-pager-preference'

describe('command pager preference', () => {
  it('defaults to current work and persists both toggle values', () => {
    expect(loadCommandPagerIncludeClosed({ getItem: () => null })).toBe(false)
    expect(loadCommandPagerIncludeClosed({ getItem: () => 'true' })).toBe(true)
    expect(loadCommandPagerIncludeClosed({ getItem: () => 'false' })).toBe(false)

    const setItem = vi.fn()
    saveCommandPagerIncludeClosed({ setItem }, true)
    saveCommandPagerIncludeClosed({ setItem }, false)
    expect(setItem).toHaveBeenNthCalledWith(
      1,
      'onmove.command-pager.include-closed',
      'true'
    )
    expect(setItem).toHaveBeenNthCalledWith(
      2,
      'onmove.command-pager.include-closed',
      'false'
    )
  })

  it('falls back safely when localStorage is missing or inaccessible', () => {
    const missing = commandPagerPreferenceStorage({})
    saveCommandPagerIncludeClosed(missing, true)
    expect(loadCommandPagerIncludeClosed(missing)).toBe(true)

    const inaccessible = commandPagerPreferenceStorage({
      get localStorage(): Storage {
        throw new DOMException('Storage is disabled', 'SecurityError')
      }
    })
    expect(inaccessible).toBe(missing)
    expect(loadCommandPagerIncludeClosed(inaccessible)).toBe(true)
  })

  it('guards every Storage method and exposes a portable reset for test isolation', () => {
    const blocked = commandPagerPreferenceStorage({
      localStorage: {
        getItem: () => { throw new DOMException('Blocked', 'SecurityError') },
        setItem: () => { throw new DOMException('Blocked', 'SecurityError') },
        removeItem: () => { throw new DOMException('Blocked', 'SecurityError') }
      } as unknown as Storage
    })

    clearCommandPagerIncludeClosed(blocked)
    expect(loadCommandPagerIncludeClosed(blocked)).toBe(false)
    expect(() => saveCommandPagerIncludeClosed(blocked, true)).not.toThrow()
    expect(loadCommandPagerIncludeClosed(blocked)).toBe(true)
    clearCommandPagerIncludeClosed(blocked)
    expect(loadCommandPagerIncludeClosed(blocked)).toBe(false)
  })
})
