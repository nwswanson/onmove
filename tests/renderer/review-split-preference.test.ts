import { describe, expect, it, vi } from 'vitest'
import {
  loadReviewPrimaryPanePercent,
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
})
