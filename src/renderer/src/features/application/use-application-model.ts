import { useEffect, useState } from 'react'
import type {
  AppState,
  CreateFocusInput,
  FocusSnapshot,
  UpdateFocusInput
} from '../../../../shared/contracts'
import { isVisibleFocus } from '@/features/focus/focus-utils'

export interface ApplicationModel {
  state: AppState | null
  error: string | null
  focuses: FocusSnapshot[]
  selectedFocus: FocusSnapshot | null
  selectedFocusId: number | null
  enabled: boolean
  goHome: () => void
  selectFocus: (focusId: number) => void
  createFocus: (input: CreateFocusInput) => Promise<void>
  updateFocus: (focusId: number, input: UpdateFocusInput) => Promise<void>
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
  const [selectedFocusId, setSelectedFocusId] = useState<number | null>(null)

  useEffect(() => {
    let active = true

    Promise.all([window.onmove.getAppState(), window.onmove.domain.listFocuses()]).then(
      ([nextState, nextFocuses]) => {
        if (!active) return
        setState(nextState)
        setFocuses(nextFocuses)
      },
      () => active && setError('The local database could not be opened.')
    )

    return () => {
      active = false
    }
  }, [])

  const selectedFocus =
    selectedFocusId === null
      ? null
      : (focuses.find(
          (focus) => focus.id === selectedFocusId && isVisibleFocus(focus)
        ) ?? null)

  function goHome(): void {
    setSelectedFocusId(null)
  }

  function selectFocus(focusId: number): void {
    const focus = focuses.find((candidate) => candidate.id === focusId)
    if (!focus || !isVisibleFocus(focus)) return
    setSelectedFocusId(focusId)
  }

  async function createFocus(input: CreateFocusInput): Promise<void> {
    const focus = await window.onmove.domain.createFocus(input)
    setFocuses((current) => [...current, focus])
    setSelectedFocusId(focus.id)
  }

  async function updateFocus(focusId: number, input: UpdateFocusInput): Promise<void> {
    const updated = await window.onmove.domain.updateFocus(focusId, input)
    setFocuses((current) =>
      current.map((focus) => (focus.id === updated.id ? updated : focus))
    )
    if (!isVisibleFocus(updated)) setSelectedFocusId(null)
  }

  async function deleteFocus(focusId: number): Promise<void> {
    const deleted = await window.onmove.domain.deleteFocus(focusId)
    if (!deleted) throw new Error('Focus no longer exists')
    setFocuses((current) => current.filter((focus) => focus.id !== focusId))
    setSelectedFocusId(null)
  }

  return {
    state,
    error,
    focuses,
    selectedFocus,
    selectedFocusId,
    enabled: Boolean(state),
    goHome,
    selectFocus,
    createFocus,
    updateFocus,
    deleteFocus,
    showDataFolder: () => window.onmove.showDataFolder()
  }
}
