import { useRef, useState } from 'react'
import type * as React from 'react'
import { ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface VerticalSplitPaneProps extends React.ComponentProps<'div'> {
  primary: React.ReactNode
  secondary: React.ReactNode
  separatorLabel: string
  initialPrimaryPercent?: number
  initialSecondaryCollapsed?: boolean
  minPrimaryPercent?: number
  maxPrimaryPercent?: number
  collapseThresholdPercent?: number
  secondaryLabel?: string
  collapseSecondaryLabel?: string
  expandSecondaryLabel?: string
  onPrimaryPercentChange?: (value: number) => void
  onSecondaryCollapsedChange?: (collapsed: boolean) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Domain-free, top/bottom split whose receiver owns pointer and keyboard resizing. */
export function VerticalSplitPane({
  primary,
  secondary,
  separatorLabel,
  initialPrimaryPercent = 62,
  initialSecondaryCollapsed = false,
  minPrimaryPercent = 30,
  maxPrimaryPercent = 78,
  collapseThresholdPercent = 8,
  secondaryLabel = 'Lower pane',
  collapseSecondaryLabel = 'Collapse lower pane',
  expandSecondaryLabel = 'Expand lower pane',
  onPrimaryPercentChange,
  onSecondaryCollapsedChange,
  className,
  ...props
}: VerticalSplitPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [primaryPercent, setPrimaryPercent] = useState(() => clamp(
    initialPrimaryPercent,
    minPrimaryPercent,
    maxPrimaryPercent
  ))
  const [secondaryCollapsed, setSecondaryCollapsed] = useState(initialSecondaryCollapsed)
  const [collapseArmed, setCollapseArmed] = useState(false)

  function changePrimaryPercent(value: number): void {
    const next = clamp(value, minPrimaryPercent, maxPrimaryPercent)
    setPrimaryPercent(next)
    onPrimaryPercentChange?.(next)
  }

  function changeSecondaryCollapsed(collapsed: boolean): void {
    if (secondaryCollapsed === collapsed) return
    setCollapseArmed(false)
    setSecondaryCollapsed(collapsed)
    onSecondaryCollapsedChange?.(collapsed)
  }

  function beginResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || secondaryCollapsed) return
    event.preventDefault()
    const height = containerRef.current?.getBoundingClientRect().height ?? 0
    if (height <= 0) return
    const startY = event.clientY
    const startPercent = primaryPercent
    let shouldCollapse = false

    function resize(moveEvent: PointerEvent): void {
      const deltaPercent = ((moveEvent.clientY - startY) / height) * 100
      const requestedPercent = startPercent + deltaPercent
      shouldCollapse = requestedPercent >= maxPrimaryPercent + collapseThresholdPercent
      setCollapseArmed(shouldCollapse)
      changePrimaryPercent(requestedPercent)
    }

    function removeListeners(): void {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
    }

    function finish(): void {
      removeListeners()
      if (shouldCollapse) changeSecondaryCollapsed(true)
      else setCollapseArmed(false)
    }

    function cancel(): void {
      removeListeners()
      setCollapseArmed(false)
    }

    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    if (secondaryCollapsed) {
      if (event.key === 'ArrowUp') changeSecondaryCollapsed(false)
      return
    }
    if (event.key === 'ArrowDown' && primaryPercent >= maxPrimaryPercent) {
      changeSecondaryCollapsed(true)
      return
    }
    changePrimaryPercent(primaryPercent + (event.key === 'ArrowDown' ? 5 : -5))
  }

  return (
    <div
      ref={containerRef}
      data-slot="vertical-split-pane"
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}
      {...props}
    >
      <div
        data-slot="vertical-split-pane-primary"
        className={cn(
          'min-h-0 overflow-auto',
          secondaryCollapsed ? 'flex-1' : 'shrink-0'
        )}
        style={secondaryCollapsed ? undefined : { flexBasis: `${primaryPercent}%` }}
      >
        {primary}
      </div>
      <div
        data-slot="vertical-split-pane-control"
        data-collapsed={secondaryCollapsed ? 'true' : 'false'}
        data-collapse-ready={collapseArmed ? 'true' : 'false'}
        className={cn(
          'group relative z-10 flex h-7 w-full shrink-0 items-center border-y border-border/80 bg-muted/35',
          'transition-colors hover:bg-muted/55',
          collapseArmed && 'border-primary/60 bg-primary/15'
        )}
      >
        <div
          role="separator"
          aria-label={separatorLabel}
          aria-orientation="horizontal"
          aria-valuemin={minPrimaryPercent}
          aria-valuemax={maxPrimaryPercent}
          aria-valuenow={Math.round(primaryPercent)}
          aria-valuetext={secondaryCollapsed
            ? `${secondaryLabel} collapsed`
            : `${Math.round(100 - primaryPercent)} percent for ${secondaryLabel}`}
          tabIndex={0}
          data-slot="vertical-split-pane-handle"
          className={cn(
            'relative h-full min-w-0 flex-1 touch-none outline-none',
            secondaryCollapsed ? 'cursor-default' : 'cursor-row-resize',
            'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50'
          )}
          onPointerDown={beginResize}
          onKeyDown={resizeWithKeyboard}
        >
          {secondaryCollapsed && (
            <span className="absolute inset-y-0 left-3 flex items-center text-xs font-medium text-muted-foreground">
              {secondaryLabel}
            </span>
          )}
          <GripHorizontal
            className={cn(
              'absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/75',
              collapseArmed && 'text-primary'
            )}
            aria-hidden="true"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mr-0.5 size-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
          aria-label={secondaryCollapsed ? expandSecondaryLabel : collapseSecondaryLabel}
          aria-expanded={!secondaryCollapsed}
          title={secondaryCollapsed ? expandSecondaryLabel : collapseSecondaryLabel}
          onClick={() => changeSecondaryCollapsed(!secondaryCollapsed)}
        >
          {secondaryCollapsed
            ? <ChevronUp aria-hidden="true" />
            : <ChevronDown aria-hidden="true" />}
        </Button>
      </div>
      <div
        data-slot="vertical-split-pane-secondary"
        hidden={secondaryCollapsed}
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {secondary}
      </div>
    </div>
  )
}
