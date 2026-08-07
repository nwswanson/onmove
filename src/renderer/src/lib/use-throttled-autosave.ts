import { useCallback, useEffect, useRef, useState } from 'react'

export const TEXT_AUTOSAVE_INTERVAL_MS = 750

interface UseThrottledAutosaveOptions<Value> {
  initialValue: Value
  onSave: (value: Value) => void | Promise<void>
  isEqual?: (left: Value, right: Value) => boolean
  intervalMs?: number
}

interface ThrottledAutosave<Value> {
  saving: boolean
  error: unknown | null
  schedule: (value: Value) => void
  updatePending: (value: Value) => void
  flush: (value?: Value) => Promise<void>
  cancelPending: () => void
}

type Pending<Value> = { value: Value }

/**
 * Coalesces edits into one trailing save per interval. Saves never overlap:
 * edits made during an in-flight save become the next trailing snapshot.
 */
export function useThrottledAutosave<Value>({
  initialValue,
  onSave,
  isEqual = Object.is,
  intervalMs = TEXT_AUTOSAVE_INTERVAL_MS
}: UseThrottledAutosaveOptions<Value>): ThrottledAutosave<Value> {
  const onSaveRef = useRef(onSave)
  const isEqualRef = useRef(isEqual)
  const lastSavedRef = useRef(initialValue)
  const pendingRef = useRef<Pending<Value> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const runPendingRef = useRef<() => Promise<void>>(async () => undefined)
  const mountedRef = useRef(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown | null>(null)

  useEffect(() => {
    onSaveRef.current = onSave
    isEqualRef.current = isEqual
  }, [isEqual, onSave])

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const armTimer = useCallback(() => {
    if (timerRef.current !== null || inFlightRef.current || !pendingRef.current) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void runPendingRef.current()
    }, intervalMs)
  }, [intervalMs])

  const runPending = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) {
      await inFlightRef.current
      if (pendingRef.current) await runPendingRef.current()
      return
    }

    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending || isEqualRef.current(pending.value, lastSavedRef.current)) return

    if (mountedRef.current) {
      setSaving(true)
      setError(null)
    }

    const operation = Promise.resolve().then(() => onSaveRef.current(pending.value))
    inFlightRef.current = operation
    try {
      await operation
      lastSavedRef.current = pending.value
    } catch (nextError) {
      if (mountedRef.current) setError(nextError)
    } finally {
      inFlightRef.current = null
      if (mountedRef.current) setSaving(false)
      if (pendingRef.current) armTimer()
    }
  }, [armTimer])

  useEffect(() => {
    runPendingRef.current = runPending
  }, [runPending])

  const schedule = useCallback(
    (value: Value) => {
      if (mountedRef.current) setError(null)
      if (!inFlightRef.current && isEqualRef.current(value, lastSavedRef.current)) {
        pendingRef.current = null
        clearTimer()
        return
      }
      pendingRef.current = { value }
      armTimer()
    },
    [armTimer, clearTimer]
  )

  const updatePending = useCallback(
    (value: Value) => {
      if (!pendingRef.current && timerRef.current === null && !inFlightRef.current) return
      schedule(value)
    },
    [schedule]
  )

  const flush = useCallback(
    async (value?: Value): Promise<void> => {
      if (value !== undefined) {
        if (inFlightRef.current || !isEqualRef.current(value, lastSavedRef.current)) {
          pendingRef.current = { value }
        } else {
          pendingRef.current = null
        }
      }
      clearTimer()
      if (inFlightRef.current) await inFlightRef.current
      clearTimer()
      await runPendingRef.current()
    },
    [clearTimer]
  )

  const cancelPending = useCallback(() => {
    pendingRef.current = null
    clearTimer()
    if (mountedRef.current) setError(null)
  }, [clearTimer])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
    }
  }, [clearTimer])

  return { saving, error, schedule, updatePending, flush, cancelPending }
}
