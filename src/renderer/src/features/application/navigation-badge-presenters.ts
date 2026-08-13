import type { NavigationBadgeOverviewSnapshot } from '../../../../shared/contracts'

export interface NavigationBadgeCounts {
  todos: number
  review: number
  routines: number
  due: number
}

/** Applies the application-wide sensitive-content preference to bounded counts. */
export function navigationBadgeCounts(
  overview: NavigationBadgeOverviewSnapshot,
  hideSensitiveContent: boolean
): NavigationBadgeCounts {
  const field = hideSensitiveContent ? 'nonSensitive' : 'total'
  return {
    todos: overview.todos[field],
    review: overview.review[field],
    routines: overview.routines[field],
    due: overview.due[field]
  }
}
