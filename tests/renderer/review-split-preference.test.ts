import { describe, expect, it, vi } from 'vitest'
import {
  clearReviewPrimaryPanePreference,
  loadReviewNotePaneCollapsed,
  loadReviewPrimaryPanePercent,
  reviewSplitPreferenceStorage,
  saveReviewNotePaneCollapsed,
  saveReviewPrimaryPanePercent
} from '../../src/renderer/src/features/review/review-split-preference'

describe('review split preference', () => {
  it('defaults, restores, and safely clamps persisted pane heights', () => {
    expect(loadReviewPrimaryPanePercent({ getItem: () => null })).toBe(62)
    expect(loadReviewPrimaryPanePercent({ getItem: () => '67' })).toBe(67)
    expect(loadReviewPrimaryPanePercent({ getItem: () => '999' })).toBe(78)
    expect(loadReviewPrimaryPanePercent({ getItem: () => 'not-a-number' })).toBe(62)

    const setItem = vi.fn()
    saveReviewPrimaryPanePercent({ setItem }, 12)
    expect(setItem).toHaveBeenCalledWith('onmove.review.primary-pane-percent', '30')
  })

  it('falls back safely when localStorage is missing or inaccessible', () => {
    const missing = reviewSplitPreferenceStorage({})
    clearReviewPrimaryPanePreference(missing)
    saveReviewPrimaryPanePercent(missing, 67)
    expect(loadReviewPrimaryPanePercent(missing)).toBe(67)

    const inaccessible = reviewSplitPreferenceStorage({
      get localStorage(): Storage {
        throw new DOMException('Storage is disabled', 'SecurityError')
      }
    })
    expect(inaccessible).toBe(missing)
    expect(loadReviewPrimaryPanePercent(inaccessible)).toBe(67)
  })

  it('persists and clears the Review screen collapsed state independently of height', () => {
    expect(loadReviewNotePaneCollapsed({ getItem: () => null })).toBe(false)
    expect(loadReviewNotePaneCollapsed({ getItem: () => 'true' })).toBe(true)
    expect(loadReviewNotePaneCollapsed({ getItem: () => 'false' })).toBe(false)

    const setItem = vi.fn()
    saveReviewNotePaneCollapsed({ setItem }, true)
    expect(setItem).toHaveBeenCalledWith('onmove.review.note-pane-collapsed', 'true')

    const removeItem = vi.fn()
    clearReviewPrimaryPanePreference({ getItem: vi.fn(), setItem: vi.fn(), removeItem })
    expect(removeItem).toHaveBeenCalledWith('onmove.review.primary-pane-percent')
    expect(removeItem).toHaveBeenCalledWith('onmove.review.note-pane-collapsed')
  })
})
