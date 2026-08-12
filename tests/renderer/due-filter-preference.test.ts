import { describe, expect, it, vi } from 'vitest'
import {
  dueFilterPreferenceStorage,
  loadDueHidePaused,
  saveDueHidePaused
} from '../../src/renderer/src/features/due/due-filter-preference'

describe('Due filter preference', () => {
  it('defaults to showing paused work and persists both toggle values', () => {
    expect(loadDueHidePaused({ getItem: () => null })).toBe(false)
    expect(loadDueHidePaused({ getItem: () => 'true' })).toBe(true)
    expect(loadDueHidePaused({ getItem: () => 'false' })).toBe(false)

    const setItem = vi.fn()
    saveDueHidePaused({ setItem }, true)
    saveDueHidePaused({ setItem }, false)
    expect(setItem).toHaveBeenNthCalledWith(1, 'onmove.due.hide-paused', 'true')
    expect(setItem).toHaveBeenNthCalledWith(2, 'onmove.due.hide-paused', 'false')
  })

  it('falls back safely when localStorage is missing or inaccessible', () => {
    const missing = dueFilterPreferenceStorage({})
    saveDueHidePaused(missing, true)
    expect(loadDueHidePaused(missing)).toBe(true)

    const inaccessible = dueFilterPreferenceStorage({
      get localStorage(): Storage {
        throw new DOMException('Storage is disabled', 'SecurityError')
      }
    })
    expect(inaccessible).toBe(missing)
    expect(loadDueHidePaused(inaccessible)).toBe(true)
  })
})
