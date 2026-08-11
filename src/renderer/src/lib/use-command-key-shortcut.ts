import { useEffect, useRef } from 'react'

/**
 * Registers one exact macOS Command-key shortcut at the document boundary.
 * The receiver decides when the action exists; disabled screens leave the
 * native key behavior untouched.
 */
export function useCommandKeyShortcut(
  key: string,
  onInvoke: () => void,
  enabled = true
): void {
  const onInvokeRef = useRef(onInvoke)

  useEffect(() => {
    onInvokeRef.current = onInvoke
  }, [onInvoke])

  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(event: KeyboardEvent): void {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== key.toLowerCase()
      ) return

      event.preventDefault()
      onInvokeRef.current()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, key])
}
