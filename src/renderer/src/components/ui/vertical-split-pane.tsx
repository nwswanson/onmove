import { useRef, useState } from 'react'
import type * as React from 'react'
import { cn } from '@/lib/utils'

interface VerticalSplitPaneProps extends React.ComponentProps<'div'> {
  primary: React.ReactNode
  secondary: React.ReactNode
  separatorLabel: string
  initialPrimaryPercent?: number
  minPrimaryPercent?: number
  maxPrimaryPercent?: number
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
  minPrimaryPercent = 30,
  maxPrimaryPercent = 78,
  className,
  ...props
}: VerticalSplitPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [primaryPercent, setPrimaryPercent] = useState(() => clamp(
    initialPrimaryPercent,
    minPrimaryPercent,
    maxPrimaryPercent
  ))

  function beginResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    const height = containerRef.current?.getBoundingClientRect().height ?? 0
    if (height <= 0) return
    const startY = event.clientY
    const startPercent = primaryPercent

    function resize(moveEvent: PointerEvent): void {
      const deltaPercent = ((moveEvent.clientY - startY) / height) * 100
      setPrimaryPercent(clamp(
        startPercent + deltaPercent,
        minPrimaryPercent,
        maxPrimaryPercent
      ))
    }

    function finish(): void {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    setPrimaryPercent((current) => clamp(
      current + (event.key === 'ArrowDown' ? 5 : -5),
      minPrimaryPercent,
      maxPrimaryPercent
    ))
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
        className="min-h-0 shrink-0 overflow-auto"
        style={{ flexBasis: `${primaryPercent}%` }}
      >
        {primary}
      </div>
      <div
        role="separator"
        aria-label={separatorLabel}
        aria-orientation="horizontal"
        aria-valuemin={minPrimaryPercent}
        aria-valuemax={maxPrimaryPercent}
        aria-valuenow={Math.round(primaryPercent)}
        tabIndex={0}
        data-slot="vertical-split-pane-handle"
        className={cn(
          'group relative z-10 h-2 w-full shrink-0 cursor-row-resize touch-none bg-transparent outline-none',
          'after:absolute after:top-1/2 after:right-0 after:left-0 after:h-px after:-translate-y-1/2 after:bg-border after:transition-colors',
          'hover:after:h-0.5 hover:after:bg-primary focus-visible:after:h-0.5 focus-visible:after:bg-primary'
        )}
        onPointerDown={beginResize}
        onKeyDown={resizeWithKeyboard}
      />
      <div
        data-slot="vertical-split-pane-secondary"
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {secondary}
      </div>
    </div>
  )
}
