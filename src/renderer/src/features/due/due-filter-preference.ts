const DUE_HIDE_PAUSED_STORAGE_KEY = 'onmove.due.hide-paused'

export type DueFilterPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

const fallbackValues = new Map<string, string>()
const fallbackStorage: DueFilterPreferenceStorage = {
  getItem: (key) => fallbackValues.get(key) ?? null,
  setItem: (key, value) => fallbackValues.set(key, value)
}

/**
 * Uses the renderer's durable browser store when available while remaining safe
 * in restricted windows and test environments that do not expose localStorage.
 */
export function dueFilterPreferenceStorage(
  browserWindow: { readonly localStorage?: Storage } | undefined =
    typeof window === 'undefined' ? undefined : window
): DueFilterPreferenceStorage {
  try {
    const storage = browserWindow?.localStorage
    if (storage) return storage
  } catch {
    // Access can throw a SecurityError for opaque origins or disabled storage.
  }
  return fallbackStorage
}

export function loadDueHidePaused(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(DUE_HIDE_PAUSED_STORAGE_KEY) === 'true'
}

export function saveDueHidePaused(
  storage: Pick<Storage, 'setItem'>,
  hidePaused: boolean
): void {
  storage.setItem(DUE_HIDE_PAUSED_STORAGE_KEY, String(hidePaused))
}
