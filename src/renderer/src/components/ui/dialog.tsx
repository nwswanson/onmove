import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  title: string
  description?: string
  contentClassName?: string
  children: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
}

function Dialog({
  open,
  title,
  description,
  contentClassName,
  children,
  footer,
  onClose
}: DialogProps): React.JSX.Element | null {
  const titleId = useId()
  const descriptionId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => {
      const preferred = contentRef.current?.querySelector<HTMLElement>('[autofocus]')
      const target = preferred ?? closeRef.current
      target?.focus()
    })

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        contentRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1) as HTMLElement
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/18 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl',
          contentClassName
        )}
      >
        <div className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <Button
            ref={closeRef}
            type="button"
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-1 size-8 text-muted-foreground"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/25 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function DialogField({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('space-y-1.5', className)} {...props} />
}

export { Dialog, DialogField }
