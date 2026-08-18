import type { SidebarItemIndicator } from '@/components/ui/sidebar-item-indicators'

/** Maps business inclusion facts into the generic sidebar receiver contract. */
export function sidebarIndicators(
  sensitive: boolean,
  includedInReviews: boolean
): SidebarItemIndicator[] {
  return [
    ...(sensitive ? ['sensitive' as const] : []),
    ...(!includedInReviews ? ['review-excluded' as const] : [])
  ]
}

export function sidebarIndicatorProps(
  sensitive: boolean,
  includedInReviews: boolean
): { indicators?: readonly SidebarItemIndicator[] } {
  const indicators = sidebarIndicators(sensitive, includedInReviews)
  return indicators.length > 0 ? { indicators } : {}
}
