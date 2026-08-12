export const REVIEW_PRIMARY_PANE_DEFAULT_PERCENT = 62
export const REVIEW_PRIMARY_PANE_MIN_PERCENT = 30
export const REVIEW_PRIMARY_PANE_MAX_PERCENT = 78

const REVIEW_SPLIT_STORAGE_KEY = 'onmove.review.primary-pane-percent'

function clamp(value: number): number {
  return Math.min(
    REVIEW_PRIMARY_PANE_MAX_PERCENT,
    Math.max(REVIEW_PRIMARY_PANE_MIN_PERCENT, value)
  )
}

/** Presentation-only preference; a mounted window keeps its split until Review remounts. */
export function loadReviewPrimaryPanePercent(storage: Pick<Storage, 'getItem'>): number {
  const stored = storage.getItem(REVIEW_SPLIT_STORAGE_KEY)
  if (stored === null || stored.trim() === '') return REVIEW_PRIMARY_PANE_DEFAULT_PERCENT
  const value = Number(stored)
  return Number.isFinite(value) ? clamp(value) : REVIEW_PRIMARY_PANE_DEFAULT_PERCENT
}

export function saveReviewPrimaryPanePercent(
  storage: Pick<Storage, 'setItem'>,
  value: number
): void {
  if (!Number.isFinite(value)) return
  storage.setItem(REVIEW_SPLIT_STORAGE_KEY, String(clamp(value)))
}
