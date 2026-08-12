const DUE_HIDE_PAUSED_STORAGE_KEY = 'onmove.due.hide-paused'

export type DueFilterPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

type MutableDueFilterPreferenceStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>

const fallbackValues = new Map<string, string>()
const fallbackStorage: MutableDueFilterPreferenceStorage = {
  getItem: (key) => fallbackValues.get(key) ?? null,
  setItem: (key, value) => fallbackValues.set(key, value),
  removeItem: (key) => fallbackValues.delete(key)
}

/**
 * Uses the renderer's durable browser store when available while remaining safe
 * in restricted windows and test environments that do not expose localStorage.
 */
export function dueFilterPreferenceStorage(
  browserWindow: { readonly localStorage?: Storage } | undefined =
    typeof window === 'undefined' ? undefined : window
): MutableDueFilterPreferenceStorage {
  let storage: Storage | undefined
  try {
    storage = browserWindow?.localStorage
  } catch {
    // Access can throw a SecurityError for opaque origins or disabled storage.
  }
  if (!storage) return fallbackStorage

  // Storage methods may independently throw even when the property getter
  // succeeds (opaque origins, disabled storage, or restricted test runners).
  return {
    getItem(key) {
      try {
        return storage.getItem(key)
      } catch {
        return fallbackStorage.getItem(key)
      }
    },
    setItem(key, value) {
      try {
        storage.setItem(key, value)
      } catch {
        fallbackStorage.setItem(key, value)
      }
    },
    removeItem(key) {
      try {
        storage.removeItem(key)
      } catch {
        fallbackStorage.removeItem(key)
      }
    }
  }
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

/** Clears test or user preference state without assuming browser storage exists. */
export function clearDueHidePausedPreference(
  storage: Pick<Storage, 'removeItem'> = dueFilterPreferenceStorage()
): void {
  storage.removeItem(DUE_HIDE_PAUSED_STORAGE_KEY)
}
