import { useEffect, useState } from 'react'
import type { NavigationBadgeOverviewSnapshot } from '../../../../shared/contracts'
import {
  navigationBadgeCounts,
  type NavigationBadgeCounts
} from '@/features/application/navigation-badge-presenters'

const REFRESH_COALESCE_MS = 50

/** Owns the live persistence-backed badge projection for primary navigation. */
export function useNavigationBadges(
  hideSensitiveContent: boolean
): NavigationBadgeCounts | null {
  const [overview, setOverview] = useState<NavigationBadgeOverviewSnapshot | null>(null)

  useEffect(() => {
    let active = true
    let request = 0
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let calendarTimer: ReturnType<typeof setTimeout> | undefined

    async function refresh(): Promise<void> {
      const currentRequest = ++request
      try {
        const next = await window.onmove.domain.getNavigationBadgeOverview()
        if (active && currentRequest === request) setOverview(next)
      } catch {
        // Badges are supplemental. Keep the last valid projection if refresh fails.
      }
    }

    function scheduleRefresh(): void {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined
        void refresh()
      }, REFRESH_COALESCE_MS)
    }

    function scheduleCalendarRollover(): void {
      const nextDay = new Date()
      nextDay.setHours(24, 0, 0, 50)
      calendarTimer = setTimeout(() => {
        void refresh()
        scheduleCalendarRollover()
      }, nextDay.getTime() - Date.now())
    }

    const unsubscribe = window.onmove.onNavigationBadgesInvalidated(scheduleRefresh)
    void refresh()
    scheduleCalendarRollover()
    return () => {
      active = false
      request += 1
      if (refreshTimer) clearTimeout(refreshTimer)
      if (calendarTimer) clearTimeout(calendarTimer)
      unsubscribe()
    }
  }, [])

  return overview ? navigationBadgeCounts(overview, hideSensitiveContent) : null
}
