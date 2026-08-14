export const REVIEW_PRIMARY_PANE_DEFAULT_PERCENT = 62
export const REVIEW_PRIMARY_PANE_MIN_PERCENT = 30
export const REVIEW_PRIMARY_PANE_MAX_PERCENT = 78

const REVIEW_SPLIT_STORAGE_KEY = 'onmove.review.primary-pane-percent'
const REVIEW_COLLAPSED_STORAGE_KEY = 'onmove.review.note-pane-collapsed'

export type ReviewSplitPreferenceStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>

const fallbackValues = new Map<string, string>()
const fallbackStorage: ReviewSplitPreferenceStorage = {
  getItem: (key) => fallbackValues.get(key) ?? null,
  setItem: (key, value) => fallbackValues.set(key, value),
  removeItem: (key) => fallbackValues.delete(key)
}

function clamp(value: number): number {
  return Math.min(
    REVIEW_PRIMARY_PANE_MAX_PERCENT,
    Math.max(REVIEW_PRIMARY_PANE_MIN_PERCENT, value)
  )
}

/**
 * Resolves browser persistence without assuming jsdom or a restricted renderer
 * exposes localStorage. Electron uses the durable browser store; tests and
 * storage-disabled environments retain the preference for the process lifetime.
 */
export function reviewSplitPreferenceStorage(
  browserWindow: { readonly localStorage?: Storage } | undefined =
    typeof window === 'undefined' ? undefined : window
): ReviewSplitPreferenceStorage {
  try {
    const storage = browserWindow?.localStorage
    if (storage) return storage
  } catch {
    // Access can throw a SecurityError for opaque origins or disabled storage.
  }
  return fallbackStorage
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

export function loadReviewNotePaneCollapsed(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(REVIEW_COLLAPSED_STORAGE_KEY) === 'true'
}

export function saveReviewNotePaneCollapsed(
  storage: Pick<Storage, 'setItem'>,
  collapsed: boolean
): void {
  storage.setItem(REVIEW_COLLAPSED_STORAGE_KEY, String(collapsed))
}

export function clearReviewPrimaryPanePreference(
  storage = reviewSplitPreferenceStorage()
): void {
  storage.removeItem(REVIEW_SPLIT_STORAGE_KEY)
  storage.removeItem(REVIEW_COLLAPSED_STORAGE_KEY)
}
