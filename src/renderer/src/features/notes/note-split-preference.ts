export const NOTE_SPLIT_PRIMARY_DEFAULT_PERCENT = 62
export const NOTE_SPLIT_PRIMARY_MIN_PERCENT = 30
export const NOTE_SPLIT_PRIMARY_MAX_PERCENT = 78

export type NoteSplitPreferenceStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>

const fallbackValues = new Map<string, string>()
const fallbackStorage: NoteSplitPreferenceStorage = {
  getItem: (key) => fallbackValues.get(key) ?? null,
  setItem: (key, value) => {
    fallbackValues.set(key, value)
  },
  removeItem: (key) => {
    fallbackValues.delete(key)
  }
}

function primaryPaneKey(preferenceId: string): string {
  return `onmove.${preferenceId}.primary-pane-percent`
}

function notePaneCollapsedKey(preferenceId: string): string {
  return `onmove.${preferenceId}.note-pane-collapsed`
}

function clamp(value: number): number {
  return Math.min(
    NOTE_SPLIT_PRIMARY_MAX_PERCENT,
    Math.max(NOTE_SPLIT_PRIMARY_MIN_PERCENT, value)
  )
}

/**
 * Resolves preference persistence without assuming every browser or test
 * environment exposes a complete, callable localStorage implementation.
 */
export function noteSplitPreferenceStorage(
  browserWindow: { readonly localStorage?: Storage } | undefined =
    typeof window === 'undefined' ? undefined : window
): NoteSplitPreferenceStorage {
  try {
    const storage = browserWindow?.localStorage
    if (
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function' ||
      typeof storage.removeItem !== 'function'
    ) {
      return fallbackStorage
    }
    return {
      getItem: (key) => {
        try {
          return storage.getItem(key)
        } catch {
          return fallbackStorage.getItem(key)
        }
      },
      setItem: (key, value) => {
        try {
          storage.setItem(key, value)
        } catch {
          fallbackStorage.setItem(key, value)
        }
      },
      removeItem: (key) => {
        try {
          storage.removeItem(key)
        } catch {
          fallbackStorage.removeItem(key)
        }
      }
    }
  } catch {
    return fallbackStorage
  }
}

export function loadNoteSplitPrimaryPercent(
  preferenceId: string,
  storage: Pick<Storage, 'getItem'>
): number {
  const stored = storage.getItem(primaryPaneKey(preferenceId))
  if (stored === null || stored.trim() === '') return NOTE_SPLIT_PRIMARY_DEFAULT_PERCENT
  const value = Number(stored)
  return Number.isFinite(value) ? clamp(value) : NOTE_SPLIT_PRIMARY_DEFAULT_PERCENT
}

export function saveNoteSplitPrimaryPercent(
  preferenceId: string,
  storage: Pick<Storage, 'setItem'>,
  value: number
): void {
  if (!Number.isFinite(value)) return
  storage.setItem(primaryPaneKey(preferenceId), String(clamp(value)))
}

export function loadNoteSplitCollapsed(
  preferenceId: string,
  storage: Pick<Storage, 'getItem'>
): boolean {
  return storage.getItem(notePaneCollapsedKey(preferenceId)) === 'true'
}

export function saveNoteSplitCollapsed(
  preferenceId: string,
  storage: Pick<Storage, 'setItem'>,
  collapsed: boolean
): void {
  storage.setItem(notePaneCollapsedKey(preferenceId), String(collapsed))
}

export function clearNoteSplitPreference(
  preferenceId: string,
  storage = noteSplitPreferenceStorage()
): void {
  storage.removeItem(primaryPaneKey(preferenceId))
  storage.removeItem(notePaneCollapsedKey(preferenceId))
}
