import {
  clearNoteSplitPreference,
  loadNoteSplitCollapsed,
  loadNoteSplitPrimaryPercent,
  NOTE_SPLIT_PRIMARY_DEFAULT_PERCENT,
  NOTE_SPLIT_PRIMARY_MAX_PERCENT,
  NOTE_SPLIT_PRIMARY_MIN_PERCENT,
  noteSplitPreferenceStorage,
  saveNoteSplitCollapsed,
  saveNoteSplitPrimaryPercent,
  type NoteSplitPreferenceStorage
} from '@/features/notes/note-split-preference'

const REVIEW_PREFERENCE_ID = 'review'

export const REVIEW_PRIMARY_PANE_DEFAULT_PERCENT = NOTE_SPLIT_PRIMARY_DEFAULT_PERCENT
export const REVIEW_PRIMARY_PANE_MIN_PERCENT = NOTE_SPLIT_PRIMARY_MIN_PERCENT
export const REVIEW_PRIMARY_PANE_MAX_PERCENT = NOTE_SPLIT_PRIMARY_MAX_PERCENT

export type ReviewSplitPreferenceStorage = NoteSplitPreferenceStorage
export const reviewSplitPreferenceStorage = noteSplitPreferenceStorage

/** Compatibility facade for Review callers over the generic note split preference. */
export function loadReviewPrimaryPanePercent(storage: Pick<Storage, 'getItem'>): number {
  return loadNoteSplitPrimaryPercent(REVIEW_PREFERENCE_ID, storage)
}

export function saveReviewPrimaryPanePercent(
  storage: Pick<Storage, 'setItem'>,
  value: number
): void {
  saveNoteSplitPrimaryPercent(REVIEW_PREFERENCE_ID, storage, value)
}

export function loadReviewNotePaneCollapsed(storage: Pick<Storage, 'getItem'>): boolean {
  return loadNoteSplitCollapsed(REVIEW_PREFERENCE_ID, storage)
}

export function saveReviewNotePaneCollapsed(
  storage: Pick<Storage, 'setItem'>,
  collapsed: boolean
): void {
  saveNoteSplitCollapsed(REVIEW_PREFERENCE_ID, storage, collapsed)
}

export function clearReviewPrimaryPanePreference(
  storage = reviewSplitPreferenceStorage()
): void {
  clearNoteSplitPreference(REVIEW_PREFERENCE_ID, storage)
}
