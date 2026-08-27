import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppState,
  CreateSidebarFolderInput,
  CreateFocusInput,
  FocusSnapshot,
  McpUiContextSnapshot,
  NavigationPinSnapshot,
  NavigationPinTarget,
  OnMoveEntityLinkTarget,
  SidebarFolderSnapshot,
  SidebarFolderTarget,
  UpdateFocusInput
} from '../../../../shared/contracts'
import { isVisibleFocus } from '@/features/focus/focus-utils'
import { sensitiveRecordIsVisible } from '@/features/shared/sensitivity'
import {
  loadFocusStatusSummary,
  loadThreadStatusSummary,
  type StatusSummary
} from '@/features/shared/status-summary'
import { useNavigationBadges } from '@/features/application/use-navigation-badges'
import type { NavigationBadgeCounts } from '@/features/application/navigation-badge-presenters'

export interface ApplicationModel {
  state: AppState | null
  error: string | null
  focuses: FocusSnapshot[]
  navigableFocuses: FocusSnapshot[]
  navigationPins: NavigationPinSnapshot[]
  sidebarFolders: SidebarFolderSnapshot[]
  navigableNavigationPins: NavigationPinSnapshot[]
  pinnedFocusIds: ReadonlySet<number>
  pinnedThreadIds: ReadonlySet<number>
  pinnedThreadStatusSummaries: Readonly<Record<number, StatusSummary | undefined>>
  focusStatusSummaries: Readonly<Record<number, StatusSummary | undefined>>
  navigationBadges: NavigationBadgeCounts | null
  selectedFocus: FocusSnapshot | null
  selectedFocusId: number | null
  selectedView: 'todos' | 'tags' | 'review' | 'routines' | 'due' | 'archive' | 'focus' | 'settings'
  sensitiveContentHidden: boolean
  enabled: boolean
  pendingEntityLink: OnMoveEntityLinkTarget | null
  consumeEntityLink: (target: OnMoveEntityLinkTarget) => void
  goTodos: () => void
  goTags: () => void
  goReview: () => void
  goRoutines: () => void
  goDue: () => void
  goArchive: () => void
  goSettings: () => void
  reportMcpUiContext: (context: McpUiContextSnapshot) => void
  selectFocus: (focusId: number, options?: { includeClosed?: boolean }) => boolean
  createFocus: (input: CreateFocusInput) => Promise<void>
  updateFocus: (focusId: number, input: UpdateFocusInput) => Promise<void>
  refreshFocus: (focusId: number) => Promise<FocusSnapshot>
  refreshFocusStatusSummary: (focusId: number) => Promise<void>
  deleteFocus: (focusId: number) => Promise<void>
  setNavigationPin: (target: NavigationPinTarget, pinned: boolean) => Promise<void>
  refreshNavigationPins: () => Promise<void>
  createSidebarFolder: (input: CreateSidebarFolderInput) => Promise<void>
  deleteSidebarFolder: (id: number) => Promise<void>
  setSidebarFolderMembership: (
    target: SidebarFolderTarget,
    folderId: number | null
  ) => Promise<void>
  refreshSidebarFolders: () => Promise<void>
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
  const [navigationPins, setNavigationPins] = useState<NavigationPinSnapshot[]>([])
  const [sidebarFolders, setSidebarFolders] = useState<SidebarFolderSnapshot[]>([])
  const [pinnedThreadStatusSummaries, setPinnedThreadStatusSummaries] = useState<
    Record<number, StatusSummary | undefined>
  >({})
  const navigationPinSummaryRequest = useRef(0)
  const [selectedFocusId, setSelectedFocusId] = useState<number | null>(null)
  const [closedFocusSelectionId, setClosedFocusSelectionId] = useState<number | null>(null)
  const [selectedView, setSelectedView] = useState<
    'todos' | 'tags' | 'review' | 'routines' | 'due' | 'archive' | 'focus' | 'settings'
  >('todos')
  const [sensitiveContentHidden, setSensitiveContentHidden] = useState(false)
  const [pendingEntityLink, setPendingEntityLink] = useState<OnMoveEntityLinkTarget | null>(null)
  const navigationBadges = useNavigationBadges(sensitiveContentHidden)

  function applyNavigationPins(nextPins: NavigationPinSnapshot[]): void {
    setNavigationPins(nextPins)
    const requestId = ++navigationPinSummaryRequest.current
    const pinnedThreadIds = nextPins.flatMap((pin) =>
      pin.target.type === 'thread' ? [pin.target.id] : [])
    void Promise.all(pinnedThreadIds.map(async (threadId) => {
      try {
        return [threadId, await loadThreadStatusSummary(window.onmove.domain, threadId)] as const
      } catch {
        return [threadId, undefined] as const
      }
    })).then((entries) => {
      if (requestId === navigationPinSummaryRequest.current) {
        setPinnedThreadStatusSummaries(Object.fromEntries(entries))
      }
    })
  }

  useEffect(() => {
    let active = true

    const applySensitiveContentVisibility = (hidden: boolean): void => {
      setSensitiveContentHidden(hidden)
      if (hidden) {
        setSelectedFocusId((current) =>
          current !== null &&
          focusesRef.current.some((focus) => focus.id === current && focus.sensitive)
            ? (() => {
                setSelectedView('todos')
                setClosedFocusSelectionId(null)
                return null
              })()
            : current
        )
      }
    }
    const unsubscribe = window.onmove.onSensitiveContentVisibilityChanged(
      applySensitiveContentVisibility
    )
    const unsubscribeRichText = window.onmove.richText.onDocumentChanged(({ document }) => {
      if (document.reference.type !== 'focus') return
      setFocuses((current) => {
        const next = current.map((focus) => focus.id === document.reference.id
          ? {
              ...focus,
              [document.reference.field]: document.value,
              updatedAt: document.updatedAt
            }
          : focus)
        focusesRef.current = next
        return next
      })
    })
    const unsubscribeDomain = window.onmove.onDomainChanged(() => {
      void Promise.all([
        window.onmove.domain.listFocuses(),
        window.onmove.navigationPins.list(),
        window.onmove.sidebarFolders.list()
      ]).then(([nextFocuses, nextPins, nextFolders]) => {
        focusesRef.current = nextFocuses
        setFocuses(nextFocuses)
        applyNavigationPins(nextPins)
        setSidebarFolders(nextFolders)
        void Promise.all(nextFocuses.map(async (focus) => [
          focus.id,
          await loadFocusStatusSummary(window.onmove.domain, focus.id)
        ] as const)).then((entries) => setFocusStatusSummaries(Object.fromEntries(entries)))
      }).catch(() => undefined)
    })
    const unsubscribeEntityLinks = window.onmove.onOpenEntityLink(setPendingEntityLink)
    const unsubscribeNavigationPins = window.onmove.navigationPins.onChanged((nextPins) => {
      if (active) applyNavigationPins(nextPins)
    })
    const unsubscribeSidebarFolders = window.onmove.sidebarFolders.onChanged((folders) => {
      if (active) setSidebarFolders(folders)
    })

    Promise.all([
      window.onmove.getAppState(),
      window.onmove.domain.listFocuses(),
      window.onmove.getSensitiveContentHidden(),
      window.onmove.navigationPins.list(),
      window.onmove.sidebarFolders.list()
    ]).then(
      ([nextState, nextFocuses, nextSensitiveContentHidden, nextPins, nextFolders]) => {
        if (!active) return
        focusesRef.current = nextFocuses
        applySensitiveContentVisibility(nextSensitiveContentHidden)
        setState(nextState)
        setFocuses(nextFocuses)
        applyNavigationPins(nextPins)
        setSidebarFolders(nextFolders)
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
      unsubscribeRichText()
      unsubscribeDomain()
      unsubscribeEntityLinks()
      unsubscribeNavigationPins()
      unsubscribeSidebarFolders()
    }
  }, [])

  const selectedFocus =
    selectedView !== 'focus' || selectedFocusId === null
      ? null
      : (focuses.find(
          (focus) =>
            focus.id === selectedFocusId &&
            (isVisibleFocus(focus) || focus.id === closedFocusSelectionId) &&
            sensitiveRecordIsVisible(focus, sensitiveContentHidden)
        ) ?? null)

  function goTodos(): void {
    setSelectedFocusId(null)
    setClosedFocusSelectionId(null)
    setSelectedView('todos')
  }

  function goTags(): void {
    setSelectedFocusId(null)
    setClosedFocusSelectionId(null)
    setSelectedView('tags')
  }

  function goReview(): void {
    setSelectedFocusId(null)
    setClosedFocusSelectionId(null)
    setSelectedView('review')
  }

  function goRoutines(): void {
    setSelectedFocusId(null)
    setClosedFocusSelectionId(null)
    setSelectedView('routines')
  }

  function goDue(): void {
    setSelectedFocusId(null)
    setClosedFocusSelectionId(null)
    setSelectedView('due')
  }

  function goArchive(): void {
    setSelectedFocusId(null)
    setClosedFocusSelectionId(null)
    setSelectedView('archive')
  }

  function goSettings(): void {
    setSelectedFocusId(null)
    setClosedFocusSelectionId(null)
    setSelectedView('settings')
  }

  const reportMcpUiContext = useCallback((context: McpUiContextSnapshot): void => {
    void window.onmove.mcp.setUiContext(context)
  }, [])

  const consumeEntityLink = useCallback((target: OnMoveEntityLinkTarget): void => {
    setPendingEntityLink((current) => current === target ? null : current)
  }, [])

  function selectFocus(focusId: number, options: { includeClosed?: boolean } = {}): boolean {
    const focus = focuses.find((candidate) => candidate.id === focusId)
    if (
      !focus ||
      (!isVisibleFocus(focus) && !options.includeClosed) ||
      !sensitiveRecordIsVisible(focus, sensitiveContentHidden)
    ) return false
    setClosedFocusSelectionId(isVisibleFocus(focus) ? null : focus.id)
    setSelectedFocusId(focusId)
    setSelectedView('focus')
    return true
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
    setClosedFocusSelectionId(null)
    setSelectedView('focus')
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
    if (isVisibleFocus(updated) && closedFocusSelectionId === focusId) {
      setClosedFocusSelectionId(null)
    }
    if (
      selectedView === 'focus' &&
      selectedFocusId === focusId &&
      ((!isVisibleFocus(updated) && closedFocusSelectionId !== focusId) ||
        !sensitiveRecordIsVisible(updated, sensitiveContentHidden))
    ) {
      setSelectedFocusId(null)
      setClosedFocusSelectionId(null)
      setSelectedView('todos')
    }
    if (navigationPins.some((pin) =>
      pin.target.type === 'focus' && pin.target.id === focusId)) {
      await refreshNavigationPins()
    }
  }

  async function refreshFocus(focusId: number): Promise<FocusSnapshot> {
    const nextFocuses = await window.onmove.domain.listFocuses()
    const refreshed = nextFocuses.find((focus) => focus.id === focusId)
    if (!refreshed) throw new Error('Focus no longer exists')
    focusesRef.current = nextFocuses
    setFocuses(nextFocuses)
    if (isVisibleFocus(refreshed) && closedFocusSelectionId === focusId) {
      setClosedFocusSelectionId(null)
    }
    if (
      selectedView === 'focus' &&
      selectedFocusId === focusId &&
      ((!isVisibleFocus(refreshed) && closedFocusSelectionId !== focusId) ||
        !sensitiveRecordIsVisible(refreshed, sensitiveContentHidden))
    ) {
      setSelectedFocusId(null)
      setClosedFocusSelectionId(null)
      setSelectedView('todos')
    }
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
    setClosedFocusSelectionId(null)
    setSelectedView('todos')
    await refreshNavigationPins()
  }

  async function setNavigationPin(
    target: NavigationPinTarget,
    pinned: boolean
  ): Promise<void> {
    applyNavigationPins(await window.onmove.navigationPins.set(target, pinned))
  }

  async function refreshNavigationPins(): Promise<void> {
    applyNavigationPins(await window.onmove.navigationPins.list())
  }

  async function createSidebarFolder(input: CreateSidebarFolderInput): Promise<void> {
    setSidebarFolders(await window.onmove.sidebarFolders.create(input))
  }

  async function deleteSidebarFolder(id: number): Promise<void> {
    setSidebarFolders(await window.onmove.sidebarFolders.delete(id))
  }

  async function setSidebarFolderMembership(
    target: SidebarFolderTarget,
    folderId: number | null
  ): Promise<void> {
    setSidebarFolders(await window.onmove.sidebarFolders.setMembership(target, folderId))
  }

  async function refreshSidebarFolders(): Promise<void> {
    setSidebarFolders(await window.onmove.sidebarFolders.list())
  }

  const pinnedFocusIds = new Set(
    navigationPins.flatMap((pin) => pin.target.type === 'focus' ? [pin.target.id] : [])
  )
  const pinnedThreadIds = new Set(
    navigationPins.flatMap((pin) => pin.target.type === 'thread' ? [pin.target.id] : [])
  )
  const navigableNavigationPins = navigationPins.filter((pin) =>
    (pin.status === 'active' || pin.status === 'paused') &&
    (!sensitiveContentHidden || (
      !pin.sensitive &&
      (!('ancestorSensitive' in pin) || !pin.ancestorSensitive)
    ))
  )

  return {
    state,
    error,
    focuses,
    navigableFocuses: focuses.filter(
      (focus) =>
        isVisibleFocus(focus) &&
        sensitiveRecordIsVisible(focus, sensitiveContentHidden)
    ),
    navigationPins,
    sidebarFolders,
    navigableNavigationPins,
    pinnedFocusIds,
    pinnedThreadIds,
    pinnedThreadStatusSummaries,
    focusStatusSummaries,
    navigationBadges,
    selectedFocus,
    selectedFocusId,
    selectedView,
    sensitiveContentHidden,
    enabled: Boolean(state),
    pendingEntityLink,
    consumeEntityLink,
    goTodos,
    goTags,
    goReview,
    goRoutines,
    goDue,
    goArchive,
    goSettings,
    reportMcpUiContext,
    selectFocus,
    createFocus,
    updateFocus,
    refreshFocus,
    refreshFocusStatusSummary,
    deleteFocus,
    setNavigationPin,
    refreshNavigationPins,
    createSidebarFolder,
    deleteSidebarFolder,
    setSidebarFolderMembership,
    refreshSidebarFolders
  }
}
