import { ClipboardX, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Receiver-owned sidebar metadata. Feature presenters only choose which facts apply. */
export type SidebarItemIndicator = 'sensitive' | 'review-excluded'

const INDICATOR_LABELS: Readonly<Record<SidebarItemIndicator, string>> = {
  sensitive: 'Sensitive',
  'review-excluded': 'Excluded from reviews'
}

export function sidebarItemIndicatorLabel(indicator: SidebarItemIndicator): string {
  return INDICATOR_LABELS[indicator]
}

export function SidebarItemIndicators({
  indicators,
  size = 'default',
  className
}: {
  indicators: readonly SidebarItemIndicator[] | undefined
  size?: 'default' | 'compact'
  className?: string
}): React.JSX.Element | null {
  if (!indicators?.length) return null

  // Sidebar buttons apply a general descendant SVG size; keep metadata icons
  // deliberately smaller than destination icons such as the 24px Sunflower.
  const iconClassName = size === 'compact' ? '!size-3' : '!size-3.5'

  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 text-muted-foreground/75',
        className
      )}
      data-slot="sidebar-item-indicators"
    >
      {indicators.map((indicator) => {
        const label = sidebarItemIndicatorLabel(indicator)
        return (
          <span
            key={indicator}
            role="img"
            aria-label={label}
            title={label}
            data-indicator={indicator}
          >
            {indicator === 'sensitive' ? (
              <Shield className={iconClassName} aria-hidden="true" />
            ) : (
              <ClipboardX className={iconClassName} aria-hidden="true" />
            )}
          </span>
        )
      })}
    </span>
  )
}
