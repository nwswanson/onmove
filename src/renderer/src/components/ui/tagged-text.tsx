import {
  forwardRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type UIEvent
} from 'react'
import { findTextTags } from '../../../../shared/text-tags'
import { cn } from '@/lib/utils'

export interface TaggedTextProps {
  value: string
  className?: string
}

/** Receiver-owned visual projection; the durable value remains ordinary text. */
export function TaggedText({ value, className }: TaggedTextProps): React.JSX.Element {
  const matches = findTextTags(value)
  if (matches.length === 0) {
    return className ? <span className={className}>{value}</span> : <>{value}</>
  }

  const content: ReactNode[] = []
  let offset = 0
  for (const match of matches) {
    if (match.start > offset) content.push(value.slice(offset, match.start))
    content.push(
      <span
        key={`${match.start}:${match.value}`}
        data-text-tag="true"
        className="onmove-text-tag"
      >
        {match.value}
      </span>
    )
    offset = match.end
  }
  if (offset < value.length) content.push(value.slice(offset))
  return <span className={className}>{content}</span>
}

export interface TaggedInputProps extends ComponentProps<'input'> {
  /** Styles the visual text layer without changing the real input value. */
  textClassName?: string
}

/**
 * Native single-line input behavior with a synchronized, non-interactive tag
 * layer beneath it. The submitted/accessibility value is still the literal
 * string, so tags persist through every existing model and IPC contract.
 */
export const TaggedInput = forwardRef<HTMLInputElement, TaggedInputProps>(function TaggedInput({
  className,
  textClassName,
  type = 'text',
  value,
  defaultValue,
  disabled,
  onChange,
  onScroll,
  ...props
}, ref): React.JSX.Element {
  const [draft, setDraft] = useState(() => defaultValue === undefined ? '' : String(defaultValue))
  const [scrollLeft, setScrollLeft] = useState(0)
  const visibleValue = value === undefined ? draft : String(value)

  function synchronizeScroll(event: UIEvent<HTMLInputElement>): void {
    setScrollLeft(event.currentTarget.scrollLeft)
    onScroll?.(event)
  }

  return (
    <div
      data-slot="tagged-input"
      data-disabled={disabled ? 'true' : 'false'}
      className={cn(
        'relative h-9 w-full min-w-0 overflow-hidden rounded-lg border border-border bg-background/75 text-sm shadow-xs transition-colors',
        'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/35',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 py-1 whitespace-pre text-foreground',
          textClassName
        )}
      >
        <span style={{ display: 'inline-block', transform: `translateX(-${scrollLeft}px)` }}>
          <TaggedText value={visibleValue} />
        </span>
      </div>
      <input
        {...props}
        ref={ref}
        type={type}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        data-slot="tagged-input-control"
        className="absolute inset-0 z-10 h-full w-full border-0 bg-transparent px-3 py-1 text-sm text-transparent caret-foreground outline-none placeholder:text-muted-foreground selection:bg-primary/35 selection:text-transparent"
        onChange={(event) => {
          if (value === undefined) setDraft(event.currentTarget.value)
          setScrollLeft(event.currentTarget.scrollLeft)
          onChange?.(event)
        }}
        onScroll={synchronizeScroll}
      />
    </div>
  )
})
