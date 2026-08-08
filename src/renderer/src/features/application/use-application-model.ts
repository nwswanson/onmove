import { useEffect, useRef, useState } from 'react'
import type {
  AppState,
  CreateFocusInput,
  FocusSnapshot,
  UpdateFocusInput
} from '../../../../shared/contracts'
import { isVisibleFocus } from '@/features/focus/focus-utils'
import { sensitiveRecordIsVisible } from '@/features/shared/sensitivity'
import {
  loadFocusStatusSummary,
  type StatusSummary
} from '@/features/shared/status-summary'

export interface ApplicationModel {
  state: AppState | null
  error: string | null
  focuses: FocusSnapshot[]
  navigableFocuses: FocusSnapshot[]
  focusStatusSummaries: Readonly<Record<number, StatusSummary | undefined>>
  selectedFocus: FocusSnapshot | null
  selectedFocusId: number | null
  sensitiveContentHidden: boolean
  enabled: boolean
  goHome: () => void
  selectFocus: (focusId: number) => void
  createFocus: (input: CreateFocusInput) => Promise<void>
  updateFocus: (focusId: number, input: UpdateFocusInput) => Promise<void>
  refreshFocus: (focusId: number) => Promise<FocusSnapshot>
  refreshFocusStatusSummary: (focusId: number) => Promise<void>
  deleteFocus: (focusId: number) => Promise<void>
  showDataFolder: () => Promise<void>
}

/**
 * Renderer-facing application model. It owns persistence and selection rules,
 * while the application shell remains concerned only with layout and events.
 */
export function useApplicationModel(): ApplicationModel {
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focuses, setFocuses] = useState<FocusSnapshot[]>([])
  const focusesRef = useRef<FocusSnapshot[]>([])
  const [focusStatusSummaries, setFocusStatusSummaries] = useState<
    Record<number, StatusSummary | undefined>
  >({})
  const [selectedFocusId, setSelectedFocusId] = useState<number | null>(null)
  const [sensitiveContentHidden, setSensitiveContentHidden] = useState(false)

  useEffect(() => {
    let active = true

    const applySensitiveContentVisibility = (hidden: boolean): void => {
      setSensitiveContentHidden(hidden)
      if (hidden) {
        setSelectedFocusId((current) =>
          current !== null &&
          focusesRef.current.some((focus) => focus.id === current && focus.sensitive)
            ? null
            : current
        )
      }
    }
    const unsubscribe = window.onmove.onSensitiveContentVisibilityChanged(
      applySensitiveContentVisibility
    )

    Promise.all([
      window.onmove.getAppState(),
      window.onmove.domain.listFocuses(),
      window.onmove.getSensitiveContentHidden()
    ]).then(
      ([nextState, nextFocuses, nextSensitiveContentHidden]) => {
        if (!active) return
        focusesRef.current = nextFocuses
        applySensitiveContentVisibility(nextSensitiveContentHidden)
        setState(nextState)
        setFocuses(nextFocuses)
        void Promise.all(
          nextFocuses.map(async (focus) => {
            try {
              return [
                focus.id,
                await loadFocusStatusSummary(window.onmove.domain, focus.id)
              ] as const
            } catch {
              return null
            }
          })
        ).then((entries) => {
          if (!active) return
          setFocusStatusSummaries(
            Object.fromEntries(entries.filter((entry) => entry !== null))
          )
        })
      },
      () => active && setError('The local database could not be opened.')
    )

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const selectedFocus =
    selectedFocusId === null
      ? null
      : (focuses.find(
          (focus) =>
            focus.id === selectedFocusId &&
            isVisibleFocus(focus) &&
            sensitiveRecordIsVisible(focus, sensitiveContentHidden)
        ) ?? null)

  function goHome(): void {
    setSelectedFocusId(null)
  }

  function selectFocus(focusId: number): void {
    const focus = focuses.find((candidate) => candidate.id === focusId)
    if (
      !focus ||
      !isVisibleFocus(focus) ||
      !sensitiveRecordIsVisible(focus, sensitiveContentHidden)
    ) return
    setSelectedFocusId(focusId)
  }

  async function refreshFocusStatusSummary(focusId: number): Promise<void> {
    try {
      const summary = await loadFocusStatusSummary(window.onmove.domain, focusId)
      setFocusStatusSummaries((current) => ({ ...current, [focusId]: summary }))
    } catch {
      // The sidebar retains its last materialized summary when a background refresh fails.
    }
  }

  async function createFocus(input: CreateFocusInput): Promise<void> {
    const focus = await window.onmove.domain.createFocus(input)
    setFocuses((current) => {
      const next = [...current, focus]
      focusesRef.current = next
      return next
    })
    setSelectedFocusId(focus.id)
    void refreshFocusStatusSummary(focus.id)
  }

  async function updateFocus(focusId: number, input: UpdateFocusInput): Promise<void> {
    const updated = await window.onmove.domain.updateFocus(focusId, input)
    setFocuses((current) => {
      const next = current.map((focus) =>
        focus.id === updated.id ? updated : focus
      )
      focusesRef.current = next
      return next
    })
    if (
      !isVisibleFocus(updated) ||
      !sensitiveRecordIsVisible(updated, sensitiveContentHidden)
    ) setSelectedFocusId(null)
  }

  async function refreshFocus(focusId: number): Promise<FocusSnapshot> {
    const nextFocuses = await window.onmove.domain.listFocuses()
    const refreshed = nextFocuses.find((focus) => focus.id === focusId)
    if (!refreshed) throw new Error('Focus no longer exists')
    focusesRef.current = nextFocuses
    setFocuses(nextFocuses)
    if (
      !isVisibleFocus(refreshed) ||
      !sensitiveRecordIsVisible(refreshed, sensitiveContentHidden)
    ) setSelectedFocusId(null)
    await refreshFocusStatusSummary(focusId)
    return refreshed
  }

  async function deleteFocus(focusId: number): Promise<void> {
    const deleted = await window.onmove.domain.deleteFocus(focusId)
    if (!deleted) throw new Error('Focus no longer exists')
    setFocuses((current) => {
      const next = current.filter((focus) => focus.id !== focusId)
      focusesRef.current = next
      return next
    })
    setFocusStatusSummaries((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== focusId))
    )
    setSelectedFocusId(null)
  }

  return {
    state,
    error,
    focuses,
    navigableFocuses: focuses.filter(
      (focus) =>
        isVisibleFocus(focus) &&
        sensitiveRecordIsVisible(focus, sensitiveContentHidden)
    ),
    focusStatusSummaries,
    selectedFocus,
    selectedFocusId,
    sensitiveContentHidden,
    enabled: Boolean(state),
    goHome,
    selectFocus,
    createFocus,
    updateFocus,
    refreshFocus,
    refreshFocusStatusSummary,
    deleteFocus,
    showDataFolder: () => window.onmove.showDataFolder()
  }
}
