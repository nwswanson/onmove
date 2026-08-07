import type * as React from 'react'
import { cn } from '@/lib/utils'

interface ResizeHandleProps extends Omit<React.ComponentProps<'div'>, 'onChange'> {
  label: string
  value: number
  min: number
  max: number
  /** `1` grows to the right; `-1` grows to the left. */
  direction: 1 | -1
  onChange: (value: number) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function ResizeHandle({
  label,
  value,
  min,
  max,
  direction,
  onChange,
  className,
  ...props
}: ResizeHandleProps): React.JSX.Element {
  function beginResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startValue = value

    function resize(moveEvent: PointerEvent): void {
      onChange(clamp(startValue + (moveEvent.clientX - startX) * direction, min, max))
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
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const horizontalStep = event.key === 'ArrowRight' ? 16 : -16
    onChange(clamp(value + horizontalStep * direction, min, max))
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      data-slot="resize-handle"
      className={cn(
        'group relative z-10 w-1 shrink-0 cursor-col-resize touch-none bg-transparent outline-none',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors',
        'hover:after:bg-primary focus-visible:after:w-0.5 focus-visible:after:bg-primary',
        className
      )}
      onPointerDown={beginResize}
      onKeyDown={resizeWithKeyboard}
      {...props}
    />
  )
}

export { ResizeHandle }
