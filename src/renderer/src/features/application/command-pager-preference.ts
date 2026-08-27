const COMMAND_PAGER_INCLUDE_CLOSED_KEY = 'onmove.command-pager.include-closed'

export type CommandPagerPreferenceStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>

const fallbackValues = new Map<string, string>()
const fallbackStorage: CommandPagerPreferenceStorage = {
  getItem: (key) => fallbackValues.get(key) ?? null,
  setItem: (key, value) => fallbackValues.set(key, value),
  removeItem: (key) => fallbackValues.delete(key)
}

/**
 * Presentation-only command-menu persistence. Browser storage is optional in
 * restricted Electron windows and test environments, and every operation can
 * independently throw even when the localStorage getter succeeds.
 */
export function commandPagerPreferenceStorage(
  browserWindow: { readonly localStorage?: Storage } | undefined =
    typeof window === 'undefined' ? undefined : window
): CommandPagerPreferenceStorage {
  let storage: Storage | undefined
  try {
    storage = browserWindow?.localStorage
  } catch {
    // Opaque origins and disabled storage can throw from the property getter.
  }
  if (!storage) return fallbackStorage

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

export function loadCommandPagerIncludeClosed(
  storage: Pick<Storage, 'getItem'>
): boolean {
  return storage.getItem(COMMAND_PAGER_INCLUDE_CLOSED_KEY) === 'true'
}

export function saveCommandPagerIncludeClosed(
  storage: Pick<Storage, 'setItem'>,
  includeClosed: boolean
): void {
  storage.setItem(COMMAND_PAGER_INCLUDE_CLOSED_KEY, String(includeClosed))
}

export function clearCommandPagerIncludeClosed(
  storage: Pick<Storage, 'removeItem'> = commandPagerPreferenceStorage()
): void {
  storage.removeItem(COMMAND_PAGER_INCLUDE_CLOSED_KEY)
}
